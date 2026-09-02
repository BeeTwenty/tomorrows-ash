//! Reading and writing `.dbc` client database tables.
//!
//! The format is twenty bytes of header, a block of fixed-size records, and a
//! block of NUL-terminated strings that records point into by byte offset.
//! There is no schema in the file: what a field *means* is knowledge the reader
//! brings, which is why anything here that needs to know a column takes it as a
//! parameter rather than hard-coding it. The recipe carries those numbers, so a
//! layout change is a reviewed data change and not a new build.
//!
//! One trap, and it is the reason this module does not assume the obvious:
//! `record_size` is **not** always `field_count * 4`. `CharBaseInfo` — the table
//! that decides which classes a race may pick — stores two `u8` columns in a
//! two-byte record while still declaring two fields. Code that computes record
//! size from field count reads that table as garbage.

use crate::error::{Error, Result};

const MAGIC: [u8; 4] = *b"WDBC";
const HEADER: usize = 20;

/// How many locale columns a `_Lang` string field has in 3.3.5a, plus the flags
/// column that follows them.
pub const LOCALES: usize = 16;

#[derive(Debug, Clone)]
pub struct Dbc {
    pub field_count: u32,
    pub record_size: u32,
    records: Vec<u8>,
    strings: Vec<u8>,
}

impl Dbc {
    pub fn parse(bytes: &[u8]) -> Result<Dbc> {
        if bytes.len() < HEADER || bytes[..4] != MAGIC {
            return Err(Error::Message(
                "this is not a DBC file — it does not start with WDBC".into(),
            ));
        }
        let word = |at: usize| {
            u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
        };
        let record_count = word(4) as usize;
        let field_count = word(8);
        let record_size = word(12) as usize;
        let string_size = word(16) as usize;

        let records_end = HEADER + record_count * record_size;
        let strings_end = records_end + string_size;
        if bytes.len() < strings_end {
            return Err(Error::Message(format!(
                "this DBC says it holds {record_count} records of {record_size} bytes and \
                 {string_size} bytes of strings, which needs {strings_end} bytes; the file is {}",
                bytes.len()
            )));
        }

        Ok(Dbc {
            field_count,
            record_size: record_size as u32,
            records: bytes[HEADER..records_end].to_vec(),
            strings: bytes[records_end..strings_end].to_vec(),
        })
    }

    /// An empty table with the same shape as this one. Used to build a filtered
    /// copy without inheriting rows.
    pub fn empty_like(&self) -> Dbc {
        Dbc {
            field_count: self.field_count,
            record_size: self.record_size,
            records: Vec::new(),
            // Offset zero must be the empty string, which is what every DBC
            // with no strings still carries.
            strings: vec![0],
        }
    }

    pub fn record_count(&self) -> usize {
        if self.record_size == 0 {
            return 0;
        }
        self.records.len() / self.record_size as usize
    }

    pub fn record(&self, index: usize) -> Result<&[u8]> {
        let size = self.record_size as usize;
        self.records
            .get(index * size..(index + 1) * size)
            .ok_or_else(|| Error::Message(format!("this DBC has no record {index}")))
    }

    pub fn records(&self) -> impl Iterator<Item = &[u8]> {
        self.records.chunks_exact(self.record_size.max(1) as usize)
    }

    pub fn push(&mut self, record: &[u8]) -> Result<()> {
        if record.len() != self.record_size as usize {
            return Err(Error::Message(format!(
                "a record is {} bytes in this DBC, and this one is {}",
                self.record_size,
                record.len()
            )));
        }
        self.records.extend_from_slice(record);
        Ok(())
    }

    /// Keep only the records a predicate accepts.
    pub fn retain(&mut self, mut keep: impl FnMut(&[u8]) -> bool) {
        let size = self.record_size.max(1) as usize;
        let mut kept = Vec::with_capacity(self.records.len());
        for record in self.records.chunks_exact(size) {
            if keep(record) {
                kept.extend_from_slice(record);
            }
        }
        self.records = kept;
    }

    /// A 4-byte column, by field index rather than byte offset.
    ///
    /// Only meaningful for tables whose columns really are four bytes wide;
    /// `CharBaseInfo`'s are not, and its callers read bytes directly.
    pub fn u32_field(&self, index: usize, field: usize) -> Result<u32> {
        let record = self.record(index)?;
        let at = field * 4;
        record
            .get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .ok_or_else(|| {
                Error::Message(format!(
                    "field {field} is past the end of a {}-byte record",
                    self.record_size
                ))
            })
    }

    pub fn set_u32_field(&mut self, index: usize, field: usize, value: u32) -> Result<()> {
        let size = self.record_size as usize;
        let at = index * size + field * 4;
        let slot = self
            .records
            .get_mut(at..at + 4)
            .ok_or_else(|| Error::Message(format!("no field {field} in record {index}")))?;
        slot.copy_from_slice(&value.to_le_bytes());
        Ok(())
    }

    /// The string a record's offset points at.
    pub fn string_at(&self, offset: u32) -> Result<&str> {
        let from = offset as usize;
        let block = self
            .strings
            .get(from..)
            .ok_or_else(|| Error::Message(format!("string offset {offset} is past the block")))?;
        let end = block.iter().position(|&b| b == 0).unwrap_or(block.len());
        std::str::from_utf8(&block[..end])
            .map_err(|_| Error::Message(format!("the string at {offset} is not UTF-8")))
    }

    /// Add a string to the block and return its offset, reusing one that is
    /// already there.
    ///
    /// Reuse is not an optimisation — it is what makes a rebuild deterministic
    /// when the same name is written to three rows.
    pub fn intern(&mut self, text: &str) -> u32 {
        let wanted = text.as_bytes();
        let mut at = 0usize;
        while at < self.strings.len() {
            let end = self.strings[at..]
                .iter()
                .position(|&b| b == 0)
                .map(|n| at + n)
                .unwrap_or(self.strings.len());
            if &self.strings[at..end] == wanted {
                return at as u32;
            }
            at = end + 1;
        }
        let offset = self.strings.len() as u32;
        self.strings.extend_from_slice(wanted);
        self.strings.push(0);
        offset
    }

    /// Point every locale column of a `_Lang` field at one string.
    ///
    /// All sixteen, deliberately. A `_Lang` field is sixteen offsets and a
    /// flags word, and which one the client reads depends on the language it
    /// was installed in. Writing only the English column would rename the class
    /// on an enUS client and leave "Paladin" on a deDE one — and the recipe
    /// design exists precisely so that one recipe serves every locale.
    pub fn set_localised(&mut self, index: usize, first_field: usize, text: &str) -> Result<()> {
        let offset = self.intern(text);
        for locale in 0..LOCALES {
            self.set_u32_field(index, first_field + locale, offset)?;
        }
        Ok(())
    }

    /// Read a `_Lang` field as the client running in `locale_column` would.
    /// Column zero is enUS, which is the one worth printing in a report.
    pub fn localised(
        &self,
        index: usize,
        first_field: usize,
        locale_column: usize,
    ) -> Result<&str> {
        let offset = self.u32_field(index, first_field + locale_column)?;
        self.string_at(offset)
    }

    pub fn write(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(HEADER + self.records.len() + self.strings.len());
        out.extend_from_slice(&MAGIC);
        out.extend_from_slice(&(self.record_count() as u32).to_le_bytes());
        out.extend_from_slice(&self.field_count.to_le_bytes());
        out.extend_from_slice(&self.record_size.to_le_bytes());
        out.extend_from_slice(&(self.strings.len() as u32).to_le_bytes());
        out.extend_from_slice(&self.records);
        out.extend_from_slice(&self.strings);
        out
    }
}

/* ------------------------------------------------------------------ *
 * The two tables this project cares about
 * ------------------------------------------------------------------ */

/// `DBFilesClient\ChrClasses.dbc` — one row per playable class.
pub const CHR_CLASSES: &str = "DBFilesClient\\ChrClasses.dbc";
/// `DBFilesClient\CharBaseInfo.dbc` — which classes each race may pick.
pub const CHAR_BASE_INFO: &str = "DBFilesClient\\CharBaseInfo.dbc";

/// One `CharBaseInfo` row: a race and a class, one byte each.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct RaceClass {
    pub race: u8,
    pub class: u8,
}

/// Every race/class pair the client will offer.
///
/// Reads bytes rather than fields on purpose: this table's records are two
/// bytes wide while declaring two fields, so the usual four-bytes-per-field
/// arithmetic walks straight off the end of every row.
pub fn race_classes(table: &Dbc) -> Result<Vec<RaceClass>> {
    if table.record_size != 2 {
        return Err(Error::Message(format!(
            "CharBaseInfo records are 2 bytes in every 3.3.5a client, and this one says {}. \
             Please send this message — it means the table is not the shape the patch assumes.",
            table.record_size
        )));
    }
    Ok(table
        .records()
        .map(|record| RaceClass {
            race: record[0],
            class: record[1],
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stand-in for `ChrClasses`: an ID column, then a `_Lang` field.
    fn chr_classes_like() -> Dbc {
        let field_count = 1 + LOCALES as u32 + 1;
        let record_size = field_count * 4;
        let mut table = Dbc {
            field_count,
            record_size,
            records: Vec::new(),
            strings: vec![0],
        };
        for (id, name) in [(2u32, "Paladin"), (7, "Shaman"), (8, "Mage")] {
            let offset = table.intern(name);
            let mut record = Vec::new();
            record.extend_from_slice(&id.to_le_bytes());
            for _ in 0..LOCALES {
                record.extend_from_slice(&offset.to_le_bytes());
            }
            record.extend_from_slice(&0xFF_FF_FF_FEu32.to_le_bytes());
            table.push(&record).unwrap();
        }
        table
    }

    fn char_base_info_like(rows: &[RaceClass]) -> Dbc {
        let mut table = Dbc {
            field_count: 2,
            record_size: 2,
            records: Vec::new(),
            strings: vec![0],
        };
        for row in rows {
            table.push(&[row.race, row.class]).unwrap();
        }
        table
    }

    #[test]
    fn round_trips_through_bytes() {
        let table = chr_classes_like();
        let again = Dbc::parse(&table.write()).unwrap();
        assert_eq!(again.record_count(), 3);
        assert_eq!(again.field_count, table.field_count);
        assert_eq!(again.localised(0, 1, 0).unwrap(), "Paladin");
        assert_eq!(again.localised(2, 1, 0).unwrap(), "Mage");
    }

    #[test]
    fn renaming_a_class_changes_every_locale_column() {
        let mut table = chr_classes_like();
        table.set_localised(0, 1, "Vanguard").unwrap();
        let again = Dbc::parse(&table.write()).unwrap();
        for locale in 0..LOCALES {
            assert_eq!(
                again.localised(0, 1, locale).unwrap(),
                "Vanguard",
                "locale column {locale} still says the old name"
            );
        }
        // And the other rows are untouched.
        assert_eq!(again.localised(1, 1, 0).unwrap(), "Shaman");
    }

    #[test]
    fn a_longer_name_than_the_one_it_replaces_is_fine() {
        // The reason the string block is rebuilt rather than patched in place:
        // "Skirmisher" does not fit where "Shaman" was.
        let mut table = chr_classes_like();
        table.set_localised(1, 1, "Skirmisher").unwrap();
        let again = Dbc::parse(&table.write()).unwrap();
        assert_eq!(again.localised(1, 1, 0).unwrap(), "Skirmisher");
        assert_eq!(again.localised(0, 1, 0).unwrap(), "Paladin");
        assert_eq!(again.localised(2, 1, 0).unwrap(), "Mage");
    }

    #[test]
    fn interning_the_same_name_twice_stores_it_once() {
        let mut table = chr_classes_like();
        let before = table.write().len();
        let a = table.intern("Vanguard");
        let b = table.intern("Vanguard");
        assert_eq!(a, b);
        assert_eq!(table.write().len(), before + "Vanguard\0".len());
    }

    #[test]
    fn char_base_info_records_are_two_bytes_not_eight() {
        let rows = vec![
            RaceClass { race: 1, class: 2 },
            RaceClass { race: 4, class: 5 },
        ];
        let table = char_base_info_like(&rows);
        let again = Dbc::parse(&table.write()).unwrap();
        assert_eq!(again.record_size, 2);
        assert_eq!(race_classes(&again).unwrap(), rows);
    }

    #[test]
    fn a_char_base_info_of_the_wrong_shape_is_refused_by_name() {
        let mut table = char_base_info_like(&[]);
        table.record_size = 8;
        let error = race_classes(&table).unwrap_err().to_string();
        assert!(error.contains("2 bytes"), "unhelpful: {error}");
    }

    #[test]
    fn filtering_keeps_only_what_is_wanted() {
        let mut table = char_base_info_like(&[
            RaceClass { race: 1, class: 1 },
            RaceClass { race: 1, class: 2 },
            RaceClass { race: 4, class: 5 },
        ]);
        table.retain(|record| record[1] == 2);
        assert_eq!(
            race_classes(&table).unwrap(),
            vec![RaceClass { race: 1, class: 2 }]
        );
    }

    #[test]
    fn something_that_is_not_a_dbc_says_so() {
        let error = Dbc::parse(b"not a dbc at all....").unwrap_err().to_string();
        assert!(error.contains("WDBC"), "unhelpful: {error}");
    }

    #[test]
    fn a_truncated_dbc_says_what_it_expected() {
        let mut bytes = chr_classes_like().write();
        bytes.truncate(bytes.len() - 10);
        let error = Dbc::parse(&bytes).unwrap_err().to_string();
        assert!(error.contains("the file is"), "unhelpful: {error}");
    }
}

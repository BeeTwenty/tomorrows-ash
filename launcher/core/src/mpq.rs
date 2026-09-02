//! Reading and writing MPQ archives.
//!
//! Enough of the format to do one job: read two DBC files out of a player's own
//! client, and write two edited ones back into an archive the client will load.
//! Not a general MPQ library, and deliberately not trying to be — see
//! `docs/decisions/0008-body-type-client-patch.md` §4 for why this lives here
//! at all rather than being a dependency.
//!
//! What is implemented:
//!
//! - v0 and v1 headers (WoW 3.3.5a uses both; v1 adds 64-bit offsets we read
//!   but never write)
//! - the hash and block tables, with the standard encryption
//! - sectored and single-unit files, stored or zlib-compressed
//! - writing a plain uncompressed v0 archive
//!
//! What is not, and says so rather than guessing: PKWARE DCL, bzip2, Huffman
//! and ADPCM decompression, and any form of encrypted *file* we did not write.
//! If a real client turns out to store `DBFilesClient` with one of those, the
//! error names the method byte, which is the whole reason `inspect-dbc` exists
//! before the rest of this is built on.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use crate::error::{Error, IoContext, Result};

const MAGIC: [u8; 4] = *b"MPQ\x1a";
const HEADER_V0: usize = 0x20;
/// How far in to look for the header. Real archives put it at zero; the format
/// allows a stub in front, and no stub is a megabyte long.
const HEADER_SCAN: usize = 1 << 20;

const HASH_EMPTY: u32 = 0xFFFF_FFFF;
const HASH_DELETED: u32 = 0xFFFF_FFFE;

const FLAG_EXISTS: u32 = 0x8000_0000;
const FLAG_SINGLE_UNIT: u32 = 0x0100_0000;
const FLAG_COMPRESS: u32 = 0x0000_0200;
const FLAG_IMPLODE: u32 = 0x0000_0100;
const FLAG_ENCRYPTED: u32 = 0x0001_0000;
const FLAG_FIX_KEY: u32 = 0x0002_0000;

/// Compression method bytes, as they appear in the first byte of a sector.
const COMP_ZLIB: u8 = 0x02;

/* ------------------------------------------------------------------ *
 * The crypt table, and the two things it is used for
 * ------------------------------------------------------------------ */

/// Blizzard's table, generated rather than embedded: it is 4 kB of constants
/// derived from six lines of arithmetic, and the arithmetic is the documentation.
fn crypt_table() -> &'static [u32; 0x500] {
    use std::sync::OnceLock;
    static TABLE: OnceLock<[u32; 0x500]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0u32; 0x500];
        let mut seed: u32 = 0x0010_0001;
        for index1 in 0..0x100usize {
            let mut index2 = index1;
            for _ in 0..5 {
                seed = (seed.wrapping_mul(125).wrapping_add(3)) % 0x002A_AAAB;
                let temp1 = (seed & 0xFFFF) << 16;
                seed = (seed.wrapping_mul(125).wrapping_add(3)) % 0x002A_AAAB;
                let temp2 = seed & 0xFFFF;
                table[index2] = temp1 | temp2;
                index2 += 0x100;
            }
        }
        table
    })
}

/// Which of the four hashes of a name is wanted.
#[derive(Clone, Copy)]
enum HashKind {
    /// Where in the hash table to start looking.
    Offset = 0,
    /// The two halves of the name's identity, checked together.
    NameA = 1,
    NameB = 2,
    /// The key a file's own bytes are encrypted with.
    FileKey = 3,
}

/// MPQ names are case-insensitive and backslash-separated, and the hash bakes
/// both rules in: everything is upper-cased and `/` becomes `\` first.
fn hash_string(name: &str, kind: HashKind) -> u32 {
    let table = crypt_table();
    let mut seed1: u32 = 0x7FED_7FED;
    let mut seed2: u32 = 0xEEEE_EEEE;
    let offset = (kind as usize) << 8;
    for byte in name.bytes() {
        let ch = match byte {
            b'/' => b'\\',
            b'a'..=b'z' => byte - 32,
            other => other,
        } as usize;
        seed1 = table[offset + ch] ^ (seed1.wrapping_add(seed2));
        seed2 = (ch as u32)
            .wrapping_add(seed1)
            .wrapping_add(seed2)
            .wrapping_add(seed2 << 5)
            .wrapping_add(3);
    }
    seed1
}

fn decrypt(data: &mut [u32], mut key: u32) {
    let table = crypt_table();
    let mut seed: u32 = 0xEEEE_EEEE;
    for value in data.iter_mut() {
        seed = seed.wrapping_add(table[0x400 + (key & 0xFF) as usize]);
        let decoded = *value ^ (key.wrapping_add(seed));
        key = ((!key << 0x15).wrapping_add(0x1111_1111)) | (key >> 0x0B);
        seed = decoded
            .wrapping_add(seed)
            .wrapping_add(seed << 5)
            .wrapping_add(3);
        *value = decoded;
    }
}

fn encrypt(data: &mut [u32], mut key: u32) {
    let table = crypt_table();
    let mut seed: u32 = 0xEEEE_EEEE;
    for value in data.iter_mut() {
        let plain = *value;
        seed = seed.wrapping_add(table[0x400 + (key & 0xFF) as usize]);
        *value = plain ^ (key.wrapping_add(seed));
        key = ((!key << 0x15).wrapping_add(0x1111_1111)) | (key >> 0x0B);
        seed = plain
            .wrapping_add(seed)
            .wrapping_add(seed << 5)
            .wrapping_add(3);
    }
}

/* ------------------------------------------------------------------ *
 * Little-endian reads, bounds-checked
 * ------------------------------------------------------------------ */

fn u16_at(bytes: &[u8], at: usize) -> Result<u16> {
    bytes
        .get(at..at + 2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .ok_or_else(|| truncated(at))
}

fn u32_at(bytes: &[u8], at: usize) -> Result<u32> {
    bytes
        .get(at..at + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(|| truncated(at))
}

fn truncated(at: usize) -> Error {
    Error::Message(format!(
        "this archive ends before offset {at}, so it is truncated or not an MPQ"
    ))
}

fn as_u32s(bytes: &[u8]) -> Vec<u32> {
    bytes
        .chunks_exact(4)
        .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn from_u32s(words: &[u32]) -> Vec<u8> {
    words.iter().flat_map(|w| w.to_le_bytes()).collect()
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy)]
struct HashEntry {
    name_a: u32,
    name_b: u32,
    locale: u16,
    block: u32,
}

#[derive(Debug, Clone, Copy)]
struct BlockEntry {
    position: u64,
    packed_size: u64,
    size: u64,
    flags: u32,
}

/// Where an archive's bytes come from.
///
/// A locale archive is most of a gigabyte and the launcher wants two files out
/// of it, so reading one whole into memory to fetch a hundred kilobytes would
/// be a real cost on a player's machine. Files are read by range; the in-memory
/// variant exists for tests and for archives we just built.
enum Source {
    Bytes(Vec<u8>),
    File(std::cell::RefCell<std::fs::File>, std::path::PathBuf),
}

impl Source {
    fn read_at(&self, at: usize, len: usize) -> Result<Vec<u8>> {
        match self {
            Source::Bytes(bytes) => bytes
                .get(at..at + len)
                .map(<[u8]>::to_vec)
                .ok_or_else(|| truncated(at + len)),
            Source::File(file, path) => {
                use std::io::{Read, Seek, SeekFrom};
                let mut file = file.borrow_mut();
                file.seek(SeekFrom::Start(at as u64)).at(path)?;
                let mut buffer = vec![0u8; len];
                file.read_exact(&mut buffer)
                    .map_err(|_| truncated(at + len))?;
                Ok(buffer)
            }
        }
    }
}

/// An archive's tables, with its bytes reachable but not resident.
pub struct Archive {
    source: Source,
    base: usize,
    sector_size: usize,
    hashes: Vec<HashEntry>,
    blocks: Vec<BlockEntry>,
}

impl Archive {
    /// Open an archive and read its tables. The bulk of the file is left on disk.
    pub fn open(path: &Path) -> Result<Archive> {
        let file = std::fs::File::open(path).at(path)?;
        Archive::from_source(Source::File(
            std::cell::RefCell::new(file),
            path.to_path_buf(),
        ))
        .map_err(|error| Error::Message(format!("{}: {error}", path.display())))
    }

    /// For tests, and for an archive this crate just wrote.
    pub fn parse(bytes: Vec<u8>) -> Result<Archive> {
        Archive::from_source(Source::Bytes(bytes))
    }

    fn from_source(source: Source) -> Result<Archive> {
        // The header is not always at zero: an installer can put a stub in
        // front of it. It is always at a 512-byte boundary, and in every real
        // client it is at the first one — scanning the whole file for it would
        // mean reading a gigabyte to answer a question about its first page.
        let scan = source.read_at(0, HEADER_SCAN).or_else(|_| {
            // A file smaller than the scan window: read what there is.
            (0..HEADER_SCAN)
                .rev()
                .step_by(512)
                .find_map(|len| source.read_at(0, len).ok())
                .ok_or_else(|| Error::Message("this file is too small to be an MPQ".into()))
        })?;
        let base = (0..scan.len().saturating_sub(4))
            .step_by(512)
            .find(|&at| scan.get(at..at + 4) == Some(&MAGIC))
            .ok_or_else(|| {
                Error::Message(format!(
                    "no MPQ header in the first {HEADER_SCAN} bytes of this file"
                ))
            })?;

        let header = &scan[base..];
        let format = u16_at(header, 0x0C)?;
        if format > 1 {
            return Err(Error::Message(format!(
                "this archive is MPQ format {format}; the launcher reads 0 and 1, \
                 which is what World of Warcraft 3.3.5a ships"
            )));
        }
        let sector_size = 512usize << u16_at(header, 0x0E)?;
        let hash_pos = u32_at(header, 0x10)? as usize;
        let block_pos = u32_at(header, 0x14)? as usize;
        let hash_count = u32_at(header, 0x18)? as usize;
        let block_count = u32_at(header, 0x1C)? as usize;

        // v1's high words. Absent in v0, and zero in practice for a 3.3.5a
        // client, but reading them is cheaper than being wrong about a big one.
        let (hash_hi, block_hi) = if format >= 1 && header.len() >= 0x2C {
            (
                u16_at(header, 0x24)? as usize,
                u16_at(header, 0x26)? as usize,
            )
        } else {
            (0, 0)
        };

        let hash_at = base + hash_pos + (hash_hi << 32);
        let block_at = base + block_pos + (block_hi << 32);

        let hashes = read_hash_table(&source, hash_at, hash_count)?;
        let blocks = read_block_table(&source, block_at, block_count)?;

        Ok(Archive {
            source,
            base,
            sector_size,
            hashes,
            blocks,
        })
    }

    /// Is this name in the archive?
    pub fn contains(&self, name: &str) -> bool {
        self.find(name).is_some()
    }

    fn find(&self, name: &str) -> Option<&HashEntry> {
        if self.hashes.is_empty() {
            return None;
        }
        let mask = self.hashes.len() - 1;
        let start = (hash_string(name, HashKind::Offset) as usize) & mask;
        let want_a = hash_string(name, HashKind::NameA);
        let want_b = hash_string(name, HashKind::NameB);

        // Linear probing, wrapping, stopping at the first never-used slot —
        // a deleted one is walked past, which is what makes deletion work.
        for step in 0..self.hashes.len() {
            let entry = &self.hashes[(start + step) & mask];
            if entry.block == HASH_EMPTY {
                return None;
            }
            if entry.block != HASH_DELETED && entry.name_a == want_a && entry.name_b == want_b {
                return Some(entry);
            }
        }
        None
    }

    /// Every name this archive lists, if it lists any.
    ///
    /// `(listfile)` is a convention rather than a requirement, and an archive
    /// without one is not broken — it simply cannot be enumerated, because the
    /// hash table stores hashes and not names. Callers that need a specific
    /// file should ask for it by name.
    pub fn list(&self) -> Result<Vec<String>> {
        if !self.contains("(listfile)") {
            return Ok(Vec::new());
        }
        let raw = self.read("(listfile)")?;
        let text = String::from_utf8_lossy(&raw);
        let mut names: Vec<String> = text
            .split(['\r', '\n', ';'])
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_owned)
            .collect();
        names.sort();
        names.dedup();
        Ok(names)
    }

    /// Read one file out, decompressing and decrypting as the flags require.
    pub fn read(&self, name: &str) -> Result<Vec<u8>> {
        let entry = self
            .find(name)
            .ok_or_else(|| Error::Message(format!("{name} is not in this archive")))?;
        let block = *self
            .blocks
            .get(entry.block as usize)
            .ok_or_else(|| Error::Message(format!("{name} points outside the block table")))?;

        if block.flags & FLAG_EXISTS == 0 {
            return Err(Error::Message(format!("{name} is a deleted entry")));
        }
        if block.flags & FLAG_IMPLODE != 0 {
            return Err(unsupported(name, "PKWARE DCL (the IMPLODE flag)"));
        }

        let packed = self
            .source
            .read_at(
                self.base + block.position as usize,
                block.packed_size as usize,
            )
            .map_err(|_| Error::Message(format!("{name} extends past the end of the archive")))?;
        let packed = packed.as_slice();

        let key = if block.flags & FLAG_ENCRYPTED != 0 {
            let base = hash_string(basename(name), HashKind::FileKey);
            Some(if block.flags & FLAG_FIX_KEY != 0 {
                (base.wrapping_add(block.position as u32)) ^ (block.size as u32)
            } else {
                base
            })
        } else {
            None
        };

        let size = block.size as usize;
        let compressed = block.flags & FLAG_COMPRESS != 0;

        if block.flags & FLAG_SINGLE_UNIT != 0 {
            let mut blob = packed.to_vec();
            if let Some(key) = key {
                let mut words = as_u32s(&blob);
                decrypt(&mut words, key);
                let clear = from_u32s(&words);
                blob[..clear.len()].copy_from_slice(&clear);
            }
            return if compressed && blob.len() < size {
                decompress(&blob, size, name)
            } else {
                Ok(blob)
            };
        }

        let sectors = size.div_ceil(self.sector_size).max(1);

        // Stored, unsectored: no offset table, the bytes are the file.
        if !compressed {
            let mut blob = packed.to_vec();
            if let Some(key) = key {
                let mut words = as_u32s(&blob);
                decrypt(&mut words, key);
                let clear = from_u32s(&words);
                blob[..clear.len()].copy_from_slice(&clear);
            }
            blob.truncate(size);
            return Ok(blob);
        }

        // Compressed: (sectors + 1) offsets, relative to the file's start.
        let table_bytes = (sectors + 1) * 4;
        let mut offsets = as_u32s(packed.get(..table_bytes).ok_or_else(|| {
            Error::Message(format!(
                "{name}'s sector table is past the end of the archive"
            ))
        })?);
        if let Some(key) = key {
            decrypt(&mut offsets, key.wrapping_sub(1));
        }

        let mut out = Vec::with_capacity(size);
        for index in 0..sectors {
            let from = offsets[index] as usize;
            let to = offsets[index + 1] as usize;
            if to < from || to > packed.len() {
                return Err(Error::Message(format!(
                    "{name}'s sector {index} runs from {from} to {to}, which is not inside the file"
                )));
            }
            let mut sector = packed[from..to].to_vec();
            if let Some(key) = key {
                let mut words = as_u32s(&sector);
                decrypt(&mut words, key.wrapping_add(index as u32));
                let clear = from_u32s(&words);
                sector[..clear.len()].copy_from_slice(&clear);
            }
            // The last sector is short. Everything before it is a full one.
            let want = (size - out.len()).min(self.sector_size);
            if sector.len() >= want {
                // Stored: a sector that did not get smaller is left alone, and
                // carries no method byte.
                out.extend_from_slice(&sector[..want]);
            } else {
                out.extend_from_slice(&decompress(&sector, want, name)?);
            }
        }
        out.truncate(size);
        Ok(out)
    }
}

fn basename(name: &str) -> &str {
    name.rsplit(['\\', '/']).next().unwrap_or(name)
}

fn unsupported(name: &str, what: &str) -> Error {
    Error::Message(format!(
        "{name} is compressed with {what}, which the launcher cannot read. \
         Please send this message — it decides whether the patch tool needs \
         another decompressor."
    ))
}

fn decompress(sector: &[u8], size: usize, name: &str) -> Result<Vec<u8>> {
    let (&method, body) = sector
        .split_first()
        .ok_or_else(|| Error::Message(format!("{name} has an empty compressed sector")))?;

    // The byte is a mask: more than one bit means the methods were applied in
    // sequence. WoW does not do that for data files, and guessing the order
    // would be worse than saying so.
    match method {
        COMP_ZLIB => {
            let mut out = Vec::with_capacity(size);
            flate2::read::ZlibDecoder::new(body)
                .take(size as u64)
                .read_to_end(&mut out)
                .map_err(|e| Error::Message(format!("{name}: zlib sector is corrupt: {e}")))?;
            Ok(out)
        }
        0x08 => Err(unsupported(name, "PKWARE DCL (method 0x08)")),
        0x10 => Err(unsupported(name, "bzip2 (method 0x10)")),
        0x01 => Err(unsupported(name, "Huffman (method 0x01)")),
        other => Err(unsupported(name, &format!("method 0x{other:02x}"))),
    }
}

fn read_hash_table(source: &Source, at: usize, count: usize) -> Result<Vec<HashEntry>> {
    let raw = source
        .read_at(at, count * 16)
        .map_err(|_| Error::Message("the hash table is past the end of the archive".into()))?;
    let mut words = as_u32s(&raw);
    decrypt(&mut words, hash_string("(hash table)", HashKind::FileKey));
    Ok(words
        .chunks_exact(4)
        .map(|c| HashEntry {
            name_a: c[0],
            name_b: c[1],
            locale: (c[2] & 0xFFFF) as u16,
            block: c[3],
        })
        .collect())
}

fn read_block_table(source: &Source, at: usize, count: usize) -> Result<Vec<BlockEntry>> {
    let raw = source
        .read_at(at, count * 16)
        .map_err(|_| Error::Message("the block table is past the end of the archive".into()))?;
    let mut words = as_u32s(&raw);
    decrypt(&mut words, hash_string("(block table)", HashKind::FileKey));
    Ok(words
        .chunks_exact(4)
        .map(|c| BlockEntry {
            position: c[0] as u64,
            packed_size: c[1] as u64,
            size: c[2] as u64,
            flags: c[3],
        })
        .collect())
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/// Build an uncompressed MPQ v0 archive holding the given files.
///
/// Uncompressed on purpose. The archive this writes holds two DBC files
/// totalling a few hundred kilobytes; compressing them would save nothing worth
/// the code, and every byte not written is a byte that cannot be written wrong.
///
/// Deterministic: the same inputs produce byte-identical output, with no
/// timestamps and a fixed file order. That is load-bearing rather than tidy —
/// the launcher verifies this archive against a hash it computed itself when it
/// built it, so "rebuilding gives the same bytes" is what makes that check mean
/// anything.
pub fn write(files: &[(String, Vec<u8>)]) -> Result<Vec<u8>> {
    // `(listfile)` is not required by the game, but an archive nobody can
    // enumerate is an archive nobody can debug.
    let listing = {
        let mut names: Vec<&str> = files.iter().map(|(name, _)| name.as_str()).collect();
        names.sort_unstable();
        let mut text = names.join("\r\n");
        text.push_str("\r\n");
        text
    };

    let mut entries: Vec<(String, Vec<u8>)> = files.to_vec();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    entries.push(("(listfile)".to_string(), listing.into_bytes()));

    // A power of two, and roomy: probing a table that is nearly full is slow,
    // and this one is tiny either way.
    let hash_count = entries.len().next_power_of_two().max(16) * 2;

    let mut body = Vec::new();
    let mut blocks: Vec<BlockEntry> = Vec::new();
    for (_, data) in &entries {
        let position = (HEADER_V0 + body.len()) as u64;
        body.extend_from_slice(data);
        blocks.push(BlockEntry {
            position,
            packed_size: data.len() as u64,
            size: data.len() as u64,
            // Stored, unencrypted, not single-unit: the plainest file an MPQ
            // can hold, and the one with the fewest ways to be wrong.
            flags: FLAG_EXISTS,
        });
    }

    let mut hashes = vec![
        HashEntry {
            name_a: 0xFFFF_FFFF,
            name_b: 0xFFFF_FFFF,
            locale: 0,
            block: HASH_EMPTY,
        };
        hash_count
    ];
    let mask = hash_count - 1;
    for (index, (name, _)) in entries.iter().enumerate() {
        let start = (hash_string(name, HashKind::Offset) as usize) & mask;
        let mut placed = false;
        for step in 0..hash_count {
            let slot = (start + step) & mask;
            if hashes[slot].block == HASH_EMPTY {
                hashes[slot] = HashEntry {
                    name_a: hash_string(name, HashKind::NameA),
                    name_b: hash_string(name, HashKind::NameB),
                    // 0 is "neutral", which is what a locale-agnostic archive
                    // wants: the client takes it whatever language it runs in.
                    locale: 0,
                    block: index as u32,
                };
                placed = true;
                break;
            }
        }
        if !placed {
            return Err(Error::Message("the hash table filled up".into()));
        }
    }

    let hash_at = HEADER_V0 + body.len();
    let block_at = hash_at + hash_count * 16;
    let total = block_at + blocks.len() * 16;

    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&(HEADER_V0 as u32).to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // format 0
    out.extend_from_slice(&3u16.to_le_bytes()); // 512 << 3 = 4096-byte sectors
    out.extend_from_slice(&(hash_at as u32).to_le_bytes());
    out.extend_from_slice(&(block_at as u32).to_le_bytes());
    out.extend_from_slice(&(hash_count as u32).to_le_bytes());
    out.extend_from_slice(&(blocks.len() as u32).to_le_bytes());
    debug_assert_eq!(out.len(), HEADER_V0);
    out.extend_from_slice(&body);

    let mut hash_words: Vec<u32> = Vec::with_capacity(hash_count * 4);
    for entry in &hashes {
        hash_words.extend_from_slice(&[
            entry.name_a,
            entry.name_b,
            entry.locale as u32,
            entry.block,
        ]);
    }
    encrypt(
        &mut hash_words,
        hash_string("(hash table)", HashKind::FileKey),
    );
    out.extend_from_slice(&from_u32s(&hash_words));

    let mut block_words: Vec<u32> = Vec::with_capacity(blocks.len() * 4);
    for block in &blocks {
        block_words.extend_from_slice(&[
            block.position as u32,
            block.packed_size as u32,
            block.size as u32,
            block.flags,
        ]);
    }
    encrypt(
        &mut block_words,
        hash_string("(block table)", HashKind::FileKey),
    );
    out.extend_from_slice(&from_u32s(&block_words));

    Ok(out)
}

/* ------------------------------------------------------------------ *
 * Finding a file across a client's archives
 * ------------------------------------------------------------------ */

/// Where a file was found, and in which archive.
pub struct Found {
    pub archive: std::path::PathBuf,
    pub bytes: Vec<u8>,
}

/// Read a file as the *client* would see it: the last archive to define it wins.
///
/// WoW loads its archives in a fixed order and later ones shadow earlier ones,
/// so `DBFilesClient\ChrClasses.dbc` from `patch-enUS-3.MPQ` is the one on
/// screen even though `locale-enUS.MPQ` also has a copy. Reading the base
/// archive and calling it the answer is a mistake that only shows up on a
/// client that has been patched, which is every real client.
pub fn read_effective(archives: &[std::path::PathBuf], name: &str) -> Result<Found> {
    let mut found: Option<Found> = None;
    let mut failures: Vec<String> = Vec::new();

    for path in archives {
        let archive = match Archive::open(path) {
            Ok(archive) => archive,
            Err(error) => {
                failures.push(error.to_string());
                continue;
            }
        };
        if !archive.contains(name) {
            continue;
        }
        match archive.read(name) {
            Ok(bytes) => {
                found = Some(Found {
                    archive: path.clone(),
                    bytes,
                })
            }
            Err(error) => failures.push(error.to_string()),
        }
    }

    found.ok_or_else(|| {
        let mut message = format!("{name} was not found in any of this client's archives");
        if !failures.is_empty() {
            message.push_str("\n  ");
            message.push_str(&failures.join("\n  "));
        }
        Error::Message(message)
    })
}

/// The archives a 3.3.5a client loads, lowest priority first.
///
/// Only the ones that exist are returned, and the order is the one the game
/// uses: base archives, then the locale's, then numbered patches within each.
/// `patch-4` upward is where custom content conventionally goes, so ours sorts
/// last and wins — which is the whole mechanism.
pub fn load_order(client_root: &Path, locale: &str) -> Vec<std::path::PathBuf> {
    let data = client_root.join("Data");
    let mut order: Vec<std::path::PathBuf> = Vec::new();

    for name in ["common", "common-2", "expansion", "lichking"] {
        order.push(data.join(format!("{name}.MPQ")));
    }
    order.push(data.join("patch.MPQ"));
    for n in 2..=9 {
        order.push(data.join(format!("patch-{n}.MPQ")));
    }

    let locale_dir = data.join(locale);
    for name in [
        format!("locale-{locale}"),
        format!("expansion-locale-{locale}"),
        format!("lichking-locale-{locale}"),
        format!("base-{locale}"),
        format!("speech-{locale}"),
        format!("expansion-speech-{locale}"),
        format!("lichking-speech-{locale}"),
    ] {
        order.push(locale_dir.join(format!("{name}.MPQ")));
    }
    order.push(locale_dir.join(format!("patch-{locale}.MPQ")));
    for n in 2..=9 {
        order.push(locale_dir.join(format!("patch-{locale}-{n}.MPQ")));
    }

    order.retain(|path| path.is_file());
    order
}

/// Sizes of every archive found, for a report that has to explain itself.
pub fn describe(archives: &[std::path::PathBuf]) -> HashMap<std::path::PathBuf, u64> {
    archives
        .iter()
        .filter_map(|path| {
            std::fs::metadata(path)
                .ok()
                .map(|meta| (path.clone(), meta.len()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The two values every MPQ implementation agrees on. If the crypt table
    /// were generated wrongly these would be the first thing to move, and
    /// every other test here would still pass against a consistently wrong
    /// implementation — which is exactly the failure a round-trip cannot see.
    #[test]
    fn hashes_the_table_names_the_way_every_other_implementation_does() {
        assert_eq!(hash_string("(hash table)", HashKind::FileKey), 0xC3AF3770);
        assert_eq!(hash_string("(block table)", HashKind::FileKey), 0xEC83B3A3);
    }

    #[test]
    fn a_name_hashes_the_same_however_it_is_written() {
        for kind in [HashKind::Offset, HashKind::NameA, HashKind::NameB] {
            assert_eq!(
                hash_string("DBFilesClient\\ChrClasses.dbc", kind),
                hash_string("dbfilesclient/chrclasses.DBC", kind),
                "case and separator must not change the hash"
            );
        }
    }

    #[test]
    fn encryption_round_trips() {
        let original: Vec<u32> = (0..64u32).map(|n| n.wrapping_mul(2654435761)).collect();
        let mut data = original.clone();
        let key = hash_string("(block table)", HashKind::FileKey);
        encrypt(&mut data, key);
        assert_ne!(data, original, "encryption did nothing");
        decrypt(&mut data, key);
        assert_eq!(data, original);
    }

    fn sample() -> Vec<(String, Vec<u8>)> {
        vec![
            (
                "DBFilesClient\\ChrClasses.dbc".to_string(),
                (0..5000u32).flat_map(|n| n.to_le_bytes()).collect(),
            ),
            ("DBFilesClient\\CharBaseInfo.dbc".to_string(), vec![7u8; 33]),
        ]
    }

    #[test]
    fn writes_an_archive_it_can_read_back() {
        let archive = Archive::parse(write(&sample()).unwrap()).unwrap();
        for (name, data) in sample() {
            assert!(archive.contains(&name), "{name} is missing");
            assert_eq!(archive.read(&name).unwrap(), data, "{name} came back wrong");
        }
    }

    #[test]
    fn a_written_archive_lists_what_is_in_it() {
        let archive = Archive::parse(write(&sample()).unwrap()).unwrap();
        assert_eq!(
            archive.list().unwrap(),
            vec![
                "DBFilesClient\\CharBaseInfo.dbc".to_string(),
                "DBFilesClient\\ChrClasses.dbc".to_string(),
            ]
        );
    }

    #[test]
    fn names_are_matched_case_insensitively_like_the_game_does() {
        let archive = Archive::parse(write(&sample()).unwrap()).unwrap();
        assert!(archive.contains("dbfilesclient/chrclasses.dbc"));
    }

    /// The whole verification story for the generated patch rests on this: the
    /// launcher checks the archive against a hash it took when it built it, so
    /// building twice from the same inputs has to give the same bytes.
    #[test]
    fn writing_is_deterministic() {
        assert_eq!(write(&sample()).unwrap(), write(&sample()).unwrap());
    }

    #[test]
    fn a_missing_name_is_an_error_that_names_it() {
        let archive = Archive::parse(write(&sample()).unwrap()).unwrap();
        let error = archive
            .read("DBFilesClient\\Spell.dbc")
            .unwrap_err()
            .to_string();
        assert!(error.contains("Spell.dbc"), "unhelpful: {error}");
    }

    #[test]
    fn something_that_is_not_an_archive_says_so() {
        let error = match Archive::parse(vec![0u8; 4096]) {
            Err(error) => error.to_string(),
            Ok(_) => panic!("4 kB of zeroes was accepted as an archive"),
        };
        assert!(error.contains("no MPQ header"), "unhelpful: {error}");
    }

    #[test]
    fn the_load_order_puts_custom_patches_last() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("Data/enUS");
        std::fs::create_dir_all(&data).unwrap();
        for name in ["locale-enUS.MPQ", "patch-enUS.MPQ", "patch-enUS-4.MPQ"] {
            std::fs::write(data.join(name), b"x").unwrap();
        }
        std::fs::write(dir.path().join("Data/common.MPQ"), b"x").unwrap();

        let order = load_order(dir.path(), "enUS");
        let names: Vec<String> = order
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            names,
            vec![
                "common.MPQ",
                "locale-enUS.MPQ",
                "patch-enUS.MPQ",
                "patch-enUS-4.MPQ"
            ],
            "later archives must shadow earlier ones, and ours must be last"
        );
    }

    #[test]
    fn the_effective_read_takes_the_last_archive_that_has_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let low = dir.path().join("low.MPQ");
        let high = dir.path().join("high.MPQ");
        std::fs::write(
            &low,
            write(&[("a.dbc".to_string(), b"from the base".to_vec())]).unwrap(),
        )
        .unwrap();
        std::fs::write(
            &high,
            write(&[("a.dbc".to_string(), b"from the patch".to_vec())]).unwrap(),
        )
        .unwrap();

        let found = read_effective(&[low, high.clone()], "a.dbc").unwrap();
        assert_eq!(found.bytes, b"from the patch");
        assert_eq!(found.archive, high);
    }
}

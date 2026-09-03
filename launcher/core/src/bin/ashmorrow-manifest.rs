//! Generate and check the client half of a manifest.
//!
//! ```text
//! ashmorrow-manifest hash        <client-dir> [--all]   # emit the client.files array
//! ashmorrow-manifest check       <client-dir> <manifest.json>
//! ashmorrow-manifest inspect-dbc <client-dir> [locale]  # read the class tables
//! ```
//!
//! Written in Rust rather than as a script beside the other tools for one
//! reason: the hashes it emits must be the same hashes `launcher_core::verify`
//! computes, and the only way to guarantee that is to call the same code. A
//! second implementation is a second thing to be subtly wrong.
//!
//! **What it emits is facts** — a path, a size and a hash per file. No bytes of
//! anyone's client leave the machine this runs on, which is why the output is
//! safe to commit and publish (ADR 0005, rule 4).

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use launcher_core::client::Client;
use launcher_core::dbc::{self, Dbc};
use launcher_core::manifest::Manifest;
use launcher_core::mpq;
use launcher_core::verify::{self, hash_file, HashCache};

/// The files worth hashing: the archives the game actually reads, plus the
/// executable. Hashing the whole tree would add the player's own screenshots,
/// addons and WTF settings, none of which we have an opinion about.
fn is_interesting(path: &Path, all: bool) -> bool {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    if name.eq_ignore_ascii_case("wow.exe") {
        return true;
    }
    if all {
        return true;
    }
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("mpq"))
}

fn walk(base: &Path, all: bool, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();

    for path in entries {
        if path.is_dir() {
            // Never follow the launcher's own backups back into the manifest.
            if path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with('.'))
            {
                continue;
            }
            walk(&path, all, out);
        } else if is_interesting(&path, all) {
            out.push(path);
        }
    }
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn hash(root: &Path, all: bool) -> Result<(), String> {
    let client = Client::detect(root).map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    walk(root, all, &mut files);
    if files.is_empty() {
        return Err(format!("no client archives found under {}", root.display()));
    }

    eprintln!(
        "{} — {} files, {}",
        client
            .version
            .map(|v| v.to_string())
            .unwrap_or_else(|| "unknown version".into()),
        files.len(),
        client.locales.join(", ")
    );

    let mut entries = Vec::new();
    for (index, path) in files.iter().enumerate() {
        let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
        eprintln!("  [{}/{}] {}", index + 1, files.len(), relative(root, path));
        entries.push(serde_json::json!({
            "path": relative(root, path),
            "size": size,
            "hash": hash_file(path).map_err(|e| e.to_string())?,
        }));
    }

    let document = serde_json::json!({
        "build": client.build(),
        "version": client.version.map(|v| v.to_string()),
        "locales": client.locales,
        "files": entries,
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&document).expect("plain data")
    );
    Ok(())
}

fn check(root: &Path, manifest_path: &Path) -> Result<bool, String> {
    let bytes = std::fs::read(manifest_path).map_err(|e| e.to_string())?;
    let manifest = Manifest::parse(&bytes).map_err(|e| e.to_string())?;

    let client = Client::detect(root).map_err(|e| e.to_string())?;
    if let Err(error) = client.require_build(manifest.client.build) {
        eprintln!("{error}");
    }

    let mut cache = HashCache::default();
    let report = verify::verify_client(root, &manifest, &mut cache, &|_| {});
    println!("{}", report.headline());
    for file in &report.files {
        if !file.state.is_match() {
            println!("  {} — {:?}", file.path, file.state);
        }
    }
    Ok(report.complete)
}

/* ------------------------------------------------------------------ *
 * inspect-dbc
 * ------------------------------------------------------------------ */

/// Read a client's class tables and print what is actually in them.
///
/// Read-only, and deliberately so: `docs/decisions/0010-body-type-client-patch.md`
/// §8 asks for this before anything is built on top of it, because the
/// race/class matrix in that document was reasoned out rather than read, and
/// building a patch on a remembered matrix is how you ship a character creation
/// screen with nothing on it.
///
/// Nothing leaves this machine. It prints facts about a client the person
/// running it already owns.
fn inspect_dbc(root: &Path, locale: Option<&str>) -> Result<bool, String> {
    let client = Client::detect(root).map_err(|e| e.to_string())?;
    let locale = match locale {
        // Checked against the client rather than taken on trust: an argument
        // that is not one of this client's locales is nearly always the tail of
        // a path somebody forgot to quote, and saying so here is the difference
        // between one more run and a confused half hour.
        Some(given) => match client
            .locales
            .iter()
            .find(|known| known.eq_ignore_ascii_case(given))
        {
            Some(known) => known.clone(),
            None => {
                return Err(format!(
                    "'{given}' is not a locale this client has; it has {}. \
                     (If it is part of the path, the path needs quotes.)",
                    client.locales.join(", ")
                ))
            }
        },
        None => client
            .primary_locale()
            .map_err(|e| e.to_string())?
            .to_string(),
    };
    println!("client   {}", root.display());
    println!(
        "build    {}",
        client
            .version
            .map(|v| v.to_string())
            .unwrap_or_else(|| "unknown".into())
    );
    println!("locale   {locale}   (found: {})", client.locales.join(", "));

    let archives = mpq::load_order(root, &locale);
    if archives.is_empty() {
        return Err(format!("no MPQ archives under {}/Data", root.display()));
    }
    println!("\narchives, in the order the game loads them (last wins):");
    let sizes = mpq::describe(&archives);
    for path in &archives {
        let size = sizes.get(path).copied().unwrap_or(0);
        println!(
            "  {:<28} {:>10} MB",
            path.file_name().unwrap_or_default().to_string_lossy(),
            size / 1_048_576
        );
    }

    // Each table is reported as it is read, so the "which column holds the
    // name" line lands under the table it is about rather than under the next.
    let classes = read_table(&archives, dbc::CHR_CLASSES)?;
    let name_field = report_classes(&classes);
    let races = read_table(&archives, dbc::CHAR_BASE_INFO)?;
    report_matrix(&races, &classes, name_field);

    println!("\nWhat to do with this: the recipe in launcher/recipes/ carries id_field and");
    println!("name_field. If the guess above disagrees with it, the recipe is wrong for");
    println!("this client and applying it would corrupt the table rather than rename it.");
    Ok(true)
}

fn read_table(archives: &[PathBuf], name: &str) -> Result<Dbc, String> {
    let found = mpq::read_effective(archives, name).map_err(|e| e.to_string())?;
    let table = Dbc::parse(&found.bytes).map_err(|e| e.to_string())?;
    println!(
        "\n{name}\n  from     {}\n  records  {}\n  fields   {} declared, {} bytes each{}",
        found
            .archive
            .file_name()
            .unwrap_or_default()
            .to_string_lossy(),
        table.record_count(),
        table.field_count,
        table.record_size,
        if table.record_size as usize == table.field_count as usize * 4 {
            ""
        } else {
            "   <- not four bytes per field"
        }
    );
    Ok(table)
}

/// Print every class, and work out which field the names live in.
///
/// The layout is not in the file, so this finds it — but "finds it" used to
/// mean "takes the first column that holds plausible text", and that is wrong
/// on a real client. `ChrClasses` has two string columns: `PetNameToken` at
/// field 3 and the name at field 4. The wrong one comes first.
///
/// So the shape decides instead (`dbc::lang_candidates`), and every candidate
/// is printed with its evidence rather than only the winner — when this
/// disagrees with the recipe, the next question is always "what did the other
/// columns look like", and answering it should not cost another run on
/// somebody else's machine.
fn report_classes(table: &Dbc) -> Option<usize> {
    let rows = table.record_count();
    let candidates = dbc::lang_candidates(table, 0);

    println!("\n  columns that could hold Name_Lang (16 locale columns + flags):");
    println!(
        "  {:>5}  {:>7}  {:>5}  {:>10}  first value",
        "field", "named", "bleed", "flags"
    );
    let mut shown = 0;
    for candidate in &candidates {
        // A column where nothing reads as a name is noise, not a candidate.
        if candidate.named == 0 {
            continue;
        }
        shown += 1;
        println!(
            "  {:>5}  {:>3}/{:<3}  {:>5}  {:>10}  {:?}{}",
            candidate.field,
            candidate.named,
            rows,
            candidate.bleed,
            candidate
                .flags
                .map(|f| f.to_string())
                .unwrap_or_else(|| "-".into()),
            candidate.sample,
            if candidate.is_clean(rows) {
                "   <- every row named, no bleed"
            } else if candidate.bleed > 0 {
                "   (bleed: another column falls inside this one's locales)"
            } else {
                "   (not every row is named)"
            }
        );
    }
    if shown == 0 {
        println!("    none — no column in this table reads as text");
    }

    let name_field = dbc::find_name_field(table, 0);
    match name_field {
        Some(field) => println!("\n  Name_Lang is field {field}"),
        None => println!(
            "\n  No single column is unambiguously Name_Lang. The recipe must not be \n               applied to this client — please send this output."
        ),
    }

    println!("\n  ID   name");
    for row in 0..rows {
        let id = table.u32_field(row, 0).unwrap_or(0);
        let name = name_field
            .and_then(|field| table.localised(row, field, 0).ok())
            .unwrap_or("?");
        println!("  {id:<4} {name}");
    }

    report_raw(table);
    name_field
}

/// The bytes themselves, for when the reading above is still not believed.
///
/// Two things have to be visible to settle an argument about a column: what
/// every field of a row actually holds, and whether the string block starts
/// with the NUL that makes offset zero mean "empty". A repacked table that
/// omits it makes every empty reference read as the first string in the block,
/// which is how a column of blanks can print as a column of names.
fn report_raw(table: &Dbc) {
    let fields = (table.record_size as usize) / 4;
    println!("\n  record 0, every field as a raw number:");
    for chunk in 0..fields.div_ceil(8) {
        let first = chunk * 8;
        let last = (first + 8).min(fields);
        print!("  {first:>3}..{:<3}", last - 1);
        for field in first..last {
            print!(" {:>10}", table.u32_field(0, field).unwrap_or(0));
        }
        println!();
    }

    let block = table.strings();
    let leading_nul = block.first() == Some(&0);
    println!(
        "\n  string block: {} bytes, offset 0 is {}",
        block.len(),
        if leading_nul {
            "the NUL that means \"no string\" — as Blizzard writes it"
        } else {
            "NOT a NUL — this table was repacked by another tool"
        }
    );
    let head: String = block
        .iter()
        .take(96)
        .map(|&b| match b {
            0 => '·',
            b if b.is_ascii_graphic() || b == b' ' => b as char,
            _ => '?',
        })
        .collect();
    println!("  first bytes: {head}");
}

/// The race x class matrix the client will actually offer.
fn report_matrix(races: &Dbc, classes: &Dbc, name_field: Option<usize>) {
    let rows = match dbc::race_classes(races) {
        Ok(rows) => rows,
        Err(error) => {
            println!("\n  {error}");
            return;
        }
    };

    let class_name = |id: u8| -> String {
        name_field
            .and_then(|field| {
                (0..classes.record_count())
                    .find(|&row| classes.u32_field(row, 0).ok() == Some(id as u32))
                    .and_then(|row| classes.localised(row, field, 0).ok())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| id.to_string())
    };

    let mut race_ids: Vec<u8> = rows.iter().map(|r| r.race).collect();
    race_ids.sort_unstable();
    race_ids.dedup();
    let mut class_ids: Vec<u8> = rows.iter().map(|r| r.class).collect();
    class_ids.sort_unstable();
    class_ids.dedup();

    println!(
        "\nrace x class, as this client will offer it ({} rows):",
        rows.len()
    );
    print!("  race ");
    for class in &class_ids {
        print!("{:>12}", truncate(&class_name(*class), 11));
    }
    println!();
    for race in &race_ids {
        print!("  {race:<5}");
        for class in &class_ids {
            let has = rows.iter().any(|r| r.race == *race && r.class == *class);
            print!("{:>12}", if has { "yes" } else { "." });
        }
        println!();
    }
}

fn truncate(text: &str, width: usize) -> String {
    if text.len() <= width {
        text.to_string()
    } else {
        text[..width].to_string()
    }
}

/// The commands, in the order the usage text lists them.
const COMMANDS: [&str; 3] = ["hash", "check", "inspect-dbc"];

/// What a command name means when the punctuation is wrong.
///
/// `inspect--dbc`, `inspect_dbc` and `INSPECT-DBC` can only mean one thing.
/// Printing the usage text and exiting is correct and unhelpful: this tool is
/// run on somebody else's machine, at the end of a download, and every rejected
/// invocation is a round trip. So an unambiguous near miss is accepted, and
/// said out loud. Anything ambiguous still fails.
fn resolve_command(given: &str) -> Option<&'static str> {
    fn squash(text: &str) -> String {
        text.chars()
            .filter(char::is_ascii_alphanumeric)
            .collect::<String>()
            .to_ascii_lowercase()
    }

    let wanted = squash(given);
    let mut matched = COMMANDS.iter().filter(|command| squash(command) == wanted);
    let first = matched.next()?;
    matched.next().is_none().then_some(*first)
}

/// Find the client directory in arguments a shell may have split.
///
/// `inspect-dbc D:\wow\TheraWoW wotlk` is one path and no locale, not a path
/// and a locale — the missing quotes are a Windows papercut rather than a
/// mistake worth another run. The longest run of arguments that names a real
/// directory wins; when none does, the first is used, so the error names what
/// was actually typed instead of something reassembled.
///
/// Returns the directory and how many arguments it consumed.
fn client_dir(parts: &[String]) -> (PathBuf, usize) {
    for take in (1..=parts.len()).rev() {
        let joined = parts[..take].join(" ");
        if Path::new(&joined).is_dir() {
            return (PathBuf::from(joined), take);
        }
    }
    (PathBuf::from(&parts[0]), 1)
}

fn usage(problem: Option<&str>) -> ExitCode {
    if let Some(problem) = problem {
        eprintln!("error: {problem}\n");
    }
    eprintln!(
        "usage:\n  \
         ashmorrow-manifest hash        <client-dir> [--all]\n  \
         ashmorrow-manifest check       <client-dir> <manifest.json>\n  \
         ashmorrow-manifest inspect-dbc <client-dir> [locale]\n\n\
         <client-dir> is the folder holding Wow.exe, not its Data folder.\n\
         A path with a space in it needs quotes:\n  \
         ashmorrow-manifest inspect-dbc \"D:\\wow\\TheraWoW wotlk\""
    );
    ExitCode::from(2)
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(given) = args.first() else {
        return usage(None);
    };
    let Some(command) = resolve_command(given) else {
        return usage(Some(&format!("unknown command '{given}'")));
    };
    if command != given {
        eprintln!("note: reading '{given}' as '{command}'");
    }

    // Flags are pulled out first so what is left is positional and can be
    // reassembled by `client_dir`.
    let rest: Vec<String> = args[1..]
        .iter()
        .filter(|arg| !arg.starts_with("--"))
        .cloned()
        .collect();

    let result = match command {
        "hash" if !rest.is_empty() => {
            let (root, _) = client_dir(&rest);
            hash(&root, args.iter().any(|arg| arg == "--all")).map(|_| true)
        }
        "check" if rest.len() >= 2 => {
            let manifest = rest[rest.len() - 1].clone();
            let (root, _) = client_dir(&rest[..rest.len() - 1]);
            check(&root, Path::new(&manifest))
        }
        "inspect-dbc" if !rest.is_empty() => {
            let (root, used) = client_dir(&rest);
            inspect_dbc(&root, rest.get(used).map(String::as_str))
        }
        _ => {
            return usage(Some(&format!(
                "'{command}' needs {}",
                if command == "check" {
                    "a client directory and a manifest"
                } else {
                    "a client directory"
                }
            )))
        }
    };

    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_command_typed_with_the_wrong_punctuation_still_resolves() {
        for given in ["inspect-dbc", "inspect--dbc", "inspect_dbc", "INSPECT-DBC"] {
            assert_eq!(resolve_command(given), Some("inspect-dbc"), "{given}");
        }
        assert_eq!(resolve_command("hash"), Some("hash"));
        assert_eq!(resolve_command("--help"), None);
        assert_eq!(resolve_command("inspect"), None, "not a near miss, a guess");
        assert_eq!(resolve_command(""), None);
    }

    #[test]
    fn an_unquoted_path_with_spaces_is_reassembled() {
        let dir = tempfile::tempdir().unwrap();
        let client = dir.path().join("TheraWoW wotlk");
        std::fs::create_dir_all(&client).unwrap();

        let split: Vec<String> = vec![
            client
                .parent()
                .unwrap()
                .join("TheraWoW")
                .to_string_lossy()
                .into_owned(),
            "wotlk".to_string(),
        ];
        let (root, used) = client_dir(&split);
        assert_eq!(root, client);
        assert_eq!(used, 2, "the locale slot must not eat half the path");

        // A real locale after a real path is still a locale.
        let quoted: Vec<String> = vec![client.to_string_lossy().into_owned(), "enUS".to_string()];
        let (root, used) = client_dir(&quoted);
        assert_eq!(root, client);
        assert_eq!(used, 1);
    }

    #[test]
    fn a_path_that_does_not_exist_is_reported_as_typed() {
        let parts = vec!["D:/nowhere".to_string(), "wotlk".to_string()];
        let (root, used) = client_dir(&parts);
        assert_eq!(root, PathBuf::from("D:/nowhere"));
        assert_eq!(used, 1);
    }
}

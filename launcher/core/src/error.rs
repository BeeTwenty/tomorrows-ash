use std::path::PathBuf;

/// Everything that can go wrong in the core, in the words we would show a
/// player. Every variant names the thing that failed and, where the fix is not
/// obvious, what to do about it — a launcher whose whole job is diagnosis
/// cannot afford an error type that says "io error".
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("no World of Warcraft client at {0} — expected to find Wow.exe there")]
    NoClient(PathBuf),

    #[error("{path} is a {found} client; Ashmorrow needs build {wanted}")]
    WrongBuild {
        path: PathBuf,
        found: String,
        wanted: u32,
    },

    #[error("could not read a version number out of {0}; it may not be a Blizzard executable")]
    UnreadableBuild(PathBuf),

    #[error("no locale data directory under {0} — expected something like Data/enUS")]
    NoLocale(PathBuf),

    #[error("the manifest is not valid: {0}")]
    BadManifest(String),

    #[error(
        "no Wine or Proton found. Install Wine from your distribution, or Proton through Steam."
    )]
    NoWine,

    #[error("{0}")]
    Message(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// `std::io::Error` on its own never says which file it was about, which is the
/// only part a player needs. Nothing in this crate touches the filesystem
/// without going through here.
pub(crate) trait IoContext<T> {
    fn at(self, path: impl Into<PathBuf>) -> Result<T>;
}

impl<T> IoContext<T> for std::result::Result<T, std::io::Error> {
    fn at(self, path: impl Into<PathBuf>) -> Result<T> {
        self.map_err(|source| Error::Io {
            path: path.into(),
            source,
        })
    }
}

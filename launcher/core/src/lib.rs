//! The Ashmorrow launcher, minus its window.
//!
//! Everything the launcher actually *does* — deciding what a client is,
//! verifying it, writing our configuration into it, working out how to start it
//! — lives here as a plain library with no GUI dependency. The Tauri shell in
//! `../src-tauri` is a thin layer of commands over this crate.
//!
//! That split is not tidiness. It means the half that can silently corrupt
//! someone's game directory is testable on any machine, in CI, without a
//! webview, a display server, or a game.
//!
//! **What this crate will not do**, per [ADR 0005]: it never downloads, hosts,
//! links to, or embeds a locator for a Blizzard-authored file, and it never
//! modifies a Blizzard binary. The manifest types make the first of those a
//! parse error rather than a policy — see [`manifest`].
//!
//! [ADR 0005]: ../../../docs/decisions/0005-client-distribution.md

pub mod app;
pub mod client;
pub mod error;
pub mod install;
pub mod launch;
pub mod manifest;
#[cfg(feature = "net")]
pub mod net;
pub mod provision;
pub mod settings;
pub mod source;
pub mod verify;
pub mod wine;

pub use app::App;
pub use client::Client;
pub use error::{Error, Result};
pub use manifest::Manifest;
pub use settings::Settings;
pub use verify::{HashCache, Report};

/// Version of the launcher core, stamped into requests so the manifest can name
/// a minimum.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

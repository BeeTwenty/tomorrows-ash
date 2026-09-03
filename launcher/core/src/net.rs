//! The real [`Http`] implementation.
//!
//! Lives here rather than in the Tauri shell so that it compiles and is checked
//! by the same `cargo test` as everything else — the shell cannot be built
//! without a system webview, and pushing code into it means pushing it out of
//! CI's reach.
//!
//! `ureq` rather than `reqwest`: the calls are blocking and sequential, so an
//! async runtime would be carried for nothing, and rustls avoids depending on
//! whatever OpenSSL the player's distribution shipped.

use std::io::Read;
use std::time::Duration;

use crate::app::Http;
use crate::error::{Error, Result};

/// Big enough for our own patch files, small enough that a hostile or broken
/// server cannot make the launcher eat all of memory.
const MAX_RESPONSE_BYTES: u64 = 512 * 1024 * 1024;

pub struct Network {
    agent: ureq::Agent,
    user_agent: String,
}

impl Network {
    pub fn new() -> Network {
        Network {
            agent: ureq::AgentBuilder::new()
                // Short. A host that does not exist is the normal case before a
                // realm is deployed, and the interface must not sit on it.
                .timeout_connect(Duration::from_secs(5))
                .timeout_read(Duration::from_secs(120))
                .build(),
            user_agent: format!("AshmorrowLauncher/{}", crate::VERSION),
        }
    }
}

impl Default for Network {
    fn default() -> Network {
        Network::new()
    }
}

/// Refuse anything the manifest would not have allowed.
///
/// The last gate before bytes are fetched, and deliberately the *same* rule the
/// manifest validator applies rather than a second one that looks like it:
/// when these diverged, the validator rejected a whole manifest for a URL this
/// would have fetched without complaint.
fn require_https(url: &str) -> Result<()> {
    if crate::manifest::fetchable(url) {
        return Ok(());
    }
    Err(Error::Message(format!(
        "refusing to fetch {url} over plain HTTP"
    )))
}

fn read_body(response: ureq::Response, url: &str) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_RESPONSE_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|e| Error::Message(format!("{url}: {e}")))?;
    Ok(bytes)
}

fn describe(url: &str, error: ureq::Error) -> Error {
    match error {
        ureq::Error::Status(code, _) => Error::Message(format!("{url} answered {code}")),
        ureq::Error::Transport(transport) => {
            Error::Message(format!("could not reach {url}: {transport}"))
        }
    }
}

impl Http for Network {
    fn get(&self, url: &str) -> Result<Vec<u8>> {
        require_https(url)?;
        let response = self
            .agent
            .get(url)
            .set("User-Agent", &self.user_agent)
            .call()
            .map_err(|e| describe(url, e))?;
        read_body(response, url)
    }

    fn post_json(&self, url: &str, body: &str) -> Result<Vec<u8>> {
        require_https(url)?;
        let response = self
            .agent
            .post(url)
            .set("User-Agent", &self.user_agent)
            .set("Content-Type", "application/json")
            .send_string(body)
            .map_err(|e| describe(url, e))?;
        read_body(response, url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_http_is_refused_except_on_loopback() {
        assert!(require_https("http://mirror.example/client.zip").is_err());
        assert!(require_https("https://ashmorrow.example/api").is_ok());
        assert!(require_https("http://127.0.0.1:3000/api").is_ok());
        assert!(require_https("http://localhost:3000/api").is_ok());
    }

    #[test]
    fn a_get_that_cannot_connect_names_the_url_rather_than_the_socket() {
        // Port 0 never connects, so this exercises the transport error path
        // without depending on the network.
        let error = Network::new()
            .get("https://127.0.0.1:0/nope")
            .unwrap_err()
            .to_string();
        assert!(error.contains("127.0.0.1"), "got: {error}");
    }
}

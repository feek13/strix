use std::convert::Infallible;
use std::time::Duration;

use axum::response::sse::{Event, KeepAlive, Sse};
use tokio::sync::mpsc;
use tokio_stream::wrappers::UnboundedReceiverStream;

/// A sender handle for pushing SSE events into a stream.
/// Clone-friendly: multiple tasks can send events through the same stream.
#[derive(Clone)]
pub struct SseSender {
    tx: mpsc::UnboundedSender<Result<Event, Infallible>>,
}

impl SseSender {
    /// Send a JSON-serializable value as an SSE data event.
    pub fn send_json(&self, data: &impl serde::Serialize) {
        if let Ok(json) = serde_json::to_string(data) {
            let _ = self.tx.send(Ok(Event::default().data(json)));
        }
    }

    /// Send the `[DONE]` sentinel that the frontend uses to detect stream end.
    pub fn send_done(&self) {
        let _ = self.tx.send(Ok(Event::default().data("[DONE]")));
    }

    /// Check if the receiver has been dropped (client disconnected).
    pub fn is_closed(&self) -> bool {
        self.tx.is_closed()
    }
}

/// Create an SSE sender/stream pair.
/// Returns `(sender, sse_response)` — spawn work using `sender`, return `sse_response` from handler.
///
/// Matches the TypeScript `setupSSE()` in utils/sse-helpers.ts:
/// - Heartbeat every 5 seconds
/// - Stream ends when all senders are dropped
pub fn setup_sse() -> (
    SseSender,
    Sse<impl futures::Stream<Item = Result<Event, Infallible>>>,
) {
    let (tx, rx) = mpsc::unbounded_channel();
    let sender = SseSender { tx };
    let stream = UnboundedReceiverStream::new(rx);
    let sse = Sse::new(stream).keep_alive(
        KeepAlive::default()
            .interval(Duration::from_secs(5))
            .text("heartbeat"),
    );
    (sender, sse)
}

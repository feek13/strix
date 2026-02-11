/// Extract a human-readable error message from an anyhow::Error.
pub fn extract_error_message(err: &anyhow::Error) -> String {
    err.to_string()
}

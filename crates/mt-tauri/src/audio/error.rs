use thiserror::Error;

#[derive(Error, Debug)]
pub enum AudioError {
    #[error("Failed to open file: {0}")]
    FileOpen(String),

    #[error("Unsupported format: {0}")]
    UnsupportedFormat(String),

    #[error("Decode error: {0}")]
    Decode(String),

    #[error("Playback error: {0}")]
    Playback(String),

    #[error("No track loaded")]
    NoTrack,

    #[error("Seek error: {0}")]
    Seek(String),

    #[error("Stream error: {0}")]
    Stream(String),
}

impl From<std::io::Error> for AudioError {
    fn from(err: std::io::Error) -> Self {
        AudioError::FileOpen(err.to_string())
    }
}

impl From<rodio::PlayError> for AudioError {
    fn from(err: rodio::PlayError) -> Self {
        AudioError::Playback(err.to_string())
    }
}

impl From<rodio::StreamError> for AudioError {
    fn from(err: rodio::StreamError) -> Self {
        AudioError::Stream(err.to_string())
    }
}

impl From<rodio::decoder::DecoderError> for AudioError {
    fn from(err: rodio::decoder::DecoderError) -> Self {
        AudioError::Decode(err.to_string())
    }
}

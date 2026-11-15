use super::*;

const FIXTURES: &str = include_str!("../../../tests/fixtures/engine-protocol/messages.jsonl");
const OPERATIONS: &[&str] = &[
    "library.getTracks",
    "native.metadata.read",
    "engine.changed",
    "native.audio.ended",
    "control.cancel",
];

#[test]
fn shared_wire_fixtures_and_roundtrips() {
    let mut count = 0;
    for line in FIXTURES.lines() {
        let case: Value = serde_json::from_str(line).unwrap();
        let result = decode(case["wire"].as_str().unwrap().as_bytes(), OPERATIONS);
        assert_eq!(
            result.is_ok(),
            case["valid"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
        if let Some(code) = case["code"].as_str() {
            assert_eq!(result.as_ref().unwrap_err().code(), code);
        }
        if let Ok(value) = result {
            assert_eq!(
                decode(&encode(&value, OPERATIONS).unwrap(), OPERATIONS).unwrap(),
                value
            );
        }
        count += 1;
    }
    assert!(count >= 40, "fixtures must not silently disappear");
}

#[test]
fn arbitrary_read_boundaries_and_utf8_splits() {
    let lines: Vec<Value> = FIXTURES
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect();
    let body = lines[0]["wire"].as_str().unwrap();
    let wire = format!("{body}\n{body}\n");
    for chunk_size in [1, 2, 7, wire.len()] {
        let mut frames = Frames::default();
        let mut count = 0;
        for chunk in wire.as_bytes().chunks(chunk_size) {
            for byte in chunk {
                if let Some(frame) = frames.push(*byte).unwrap() {
                    decode(frame, OPERATIONS).unwrap();
                    count += 1;
                }
            }
        }
        frames.finish().unwrap();
        assert_eq!(count, 2);
    }
}

#[test]
fn bounded_framing_and_truncated_eof() {
    let mut frames = Frames::default();
    assert_eq!(frames.push(b'\n'), Err(ProtocolError::Invalid));
    assert_eq!(frames.push(b'x'), Err(ProtocolError::Invalid));
    let mut frames = Frames::default();
    frames.push(b'{').unwrap();
    assert_eq!(frames.finish(), Err(ProtocolError::Truncated));
    let mut frames = Frames::default();
    frames.push(b'\r').unwrap();
    assert_eq!(frames.push(b'\n'), Err(ProtocolError::Invalid));
    let mut frames = Frames::default();
    for _ in 0..MAX_MESSAGE_BYTES {
        frames.push(b' ').unwrap();
    }
    assert_eq!(frames.push(b' ').unwrap_err(), ProtocolError::TooLarge);
    assert!(frames.finish().is_err());
    assert_eq!(
        decode(&vec![b' '; MAX_MESSAGE_BYTES + 1], OPERATIONS).unwrap_err(),
        ProtocolError::TooLarge
    );
    assert!(decode(&[0xff], OPERATIONS).is_err());
}

#[test]
fn response_identity_status_and_depth_are_checked() {
    let lines: Vec<Value> = FIXTURES
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect();
    let request = decode(lines[0]["wire"].as_str().unwrap().as_bytes(), OPERATIONS).unwrap();
    let wire = lines[2]["wire"].as_str().unwrap().as_bytes();
    response(wire, &request, 200, OPERATIONS).unwrap();
    assert!(response(wire, &request, 503, OPERATIONS).is_err());
    for key in ["generation", "id", "operation"] {
        let mut stale = request.clone();
        stale[key] = Value::String("other".into());
        assert!(response(wire, &stale, 200, OPERATIONS).is_err());
    }
    let error_wire = serde_json::json!({
        "version":1,"kind":"response","generation":"g1","id":"ui:1",
        "operation":"library.getTracks",
        "error":{"code":"unavailable","message":"Unavailable","retryable":true}
    });
    let error_wire = encode(&error_wire, OPERATIONS).unwrap();
    response(&error_wire, &request, 503, OPERATIONS).unwrap();
    assert!(response(&error_wire, &request, 200, OPERATIONS).is_err());
    let mut deep = request;
    let mut payload = Value::Null;
    for _ in 0..33 {
        payload = serde_json::json!({"child":payload});
    }
    deep["payload"] = payload;
    assert!(encode(&deep, OPERATIONS).is_err());
    assert!(decode(wire, &[]).is_err());
}

pub mod op {
    pub const IDENTIFY: u8 = 0;
    pub const SELECT_PROTOCOL: u8 = 1;
    pub const READY: u8 = 2;
    pub const HEARTBEAT: u8 = 3;
    pub const SESSION_DESCRIPTION: u8 = 4;
    pub const SPEAKING: u8 = 5;
    pub const HEARTBEAT_ACK: u8 = 6;
    pub const RESUME: u8 = 7;
    pub const HELLO: u8 = 8;
    pub const RESUMED: u8 = 9;

    pub const CLIENTS_CONNECT: u8 = 11;
    pub const CLIENT_DISCONNECT: u8 = 13;

    pub const DAVE_PREPARE_TRANSITION: u8 = 21;
    pub const DAVE_EXECUTE_TRANSITION: u8 = 22;
    pub const DAVE_TRANSITION_READY: u8 = 23;
    pub const DAVE_PREPARE_EPOCH: u8 = 24;
    pub const DAVE_MLS_EXTERNAL_SENDER: u8 = 25;
    pub const DAVE_MLS_KEY_PACKAGE: u8 = 26;
    pub const DAVE_MLS_PROPOSALS: u8 = 27;
    pub const DAVE_MLS_COMMIT_WELCOME: u8 = 28;
    pub const DAVE_MLS_ANNOUNCE_COMMIT_TRANSITION: u8 = 29;
    pub const DAVE_MLS_WELCOME: u8 = 30;
    pub const DAVE_MLS_INVALID_COMMIT_WELCOME: u8 = 31;

    #[inline]
    pub fn is_dave(code: u8) -> bool {
        code >= DAVE_PREPARE_TRANSITION
            && code <= DAVE_MLS_INVALID_COMMIT_WELCOME
    }
}

pub mod ws_status {
    pub const CONNECTING: u8 = 0;
    pub const OPEN: u8 = 1;
    pub const CLOSING: u8 = 2;
    pub const CLOSED: u8 = 3;
}

pub mod close_codes {
    pub const SESSION_TIMEOUT: u32 = 4014;
    pub const SERVER_NOT_FOUND: u32 = 4011;
}

#[inline]
pub fn is_dave(code: u8) -> bool {
    op::is_dave(code)
}
// imagehash.rs: SHA-256 of the executables that start, so the engine can
// match them against hash lists (internal/intel) and analysts can look
// them up. Platform-independent (std only) so it is unit-tested on any
// host; the collector calls it from its enrichment thread, never from an
// ETW callback.
//
//   - Sha256: a plain FIPS 180-4 implementation (no new crate in the
//     dependency tree, no C toolchain for the Windows cross-check).
//   - HashCache: hashes by (path, size, modification time), so the
//     hundredth start of the same binary costs one stat, and a replaced
//     binary is hashed again. Bounded; files over the size cap are not
//     hashed at all (the image path is still reported).

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::time::SystemTime;

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
    0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/// Streaming SHA-256.
pub struct Sha256 {
    state: [u32; 8],
    buf: [u8; 64],
    buf_len: usize,
    total: u64,
}

impl Sha256 {
    pub fn new() -> Self {
        Sha256 {
            state: [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19],
            buf: [0; 64],
            buf_len: 0,
            total: 0,
        }
    }

    pub fn update(&mut self, mut data: &[u8]) {
        self.total = self.total.wrapping_add(data.len() as u64);
        if self.buf_len > 0 {
            let take = (64 - self.buf_len).min(data.len());
            self.buf[self.buf_len..self.buf_len + take].copy_from_slice(&data[..take]);
            self.buf_len += take;
            data = &data[take..];
            if self.buf_len < 64 {
                return;
            }
            let block = self.buf;
            self.compress(&block);
            self.buf_len = 0;
        }
        while data.len() >= 64 {
            let (block, rest) = data.split_at(64);
            self.compress(block.try_into().expect("64-byte block"));
            data = rest;
        }
        self.buf[..data.len()].copy_from_slice(data);
        self.buf_len = data.len();
    }

    pub fn finish(mut self) -> [u8; 32] {
        let bits = self.total.wrapping_mul(8);
        self.update(&[0x80]);
        while self.buf_len != 56 {
            self.update(&[0]);
        }
        self.update(&bits.to_be_bytes());
        let mut out = [0u8; 32];
        for (chunk, word) in out.as_chunks_mut::<4>().0.iter_mut().zip(self.state) {
            chunk.copy_from_slice(&word.to_be_bytes());
        }
        out
    }

    fn compress(&mut self, block: &[u8; 64]) {
        let mut w = [0u32; 64];
        for (i, word) in block.as_chunks::<4>().0.iter().enumerate() {
            w[i] = u32::from_be_bytes(*word);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = h.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (s, v) in self.state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *s = s.wrapping_add(v);
        }
    }
}

/// Lowercase hex of a digest.
pub fn hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// SHA-256 of a file, or None when it cannot be read or is larger than
/// max_bytes (checked before reading and while reading, in case it grows).
pub fn hash_file(path: &Path, max_bytes: u64) -> Option<String> {
    let mut file = File::open(path).ok()?;
    if file.metadata().ok()?.len() > max_bytes {
        return None;
    }
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut read: u64 = 0;
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        read += n as u64;
        if read > max_bytes {
            return None;
        }
        hasher.update(&buf[..n]);
    }
    Some(hex(&hasher.finish()))
}

/// Hashes by (path, size, mtime), bounded.
pub struct HashCache {
    cap: usize,
    max_bytes: u64,
    entries: HashMap<String, (u64, Option<SystemTime>, String)>,
}

impl HashCache {
    pub fn new(cap: usize, max_bytes: u64) -> Self {
        HashCache { cap, max_bytes, entries: HashMap::new() }
    }

    /// SHA-256 of the file at path, from the cache while the file keeps
    /// its size and modification time.
    pub fn sha256(&mut self, path: &str) -> Option<String> {
        let meta = std::fs::metadata(path).ok()?;
        let size = meta.len();
        let modified = meta.modified().ok();
        let key = path.to_ascii_lowercase();
        if let Some((s, m, h)) = self.entries.get(&key) {
            if *s == size && *m == modified {
                return Some(h.clone());
            }
        }
        let digest = hash_file(Path::new(path), self.max_bytes)?;
        if self.entries.len() >= self.cap && !self.entries.contains_key(&key) {
            // forget everything rather than track recency: a full cache
            // only costs re-hashing the binaries that run again
            self.entries.clear();
        }
        self.entries.insert(key, (size, modified, digest.clone()));
        Some(digest)
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sha(data: &[u8]) -> String {
        let mut h = Sha256::new();
        h.update(data);
        hex(&h.finish())
    }

    #[test]
    fn known_answer_vectors() {
        assert_eq!(sha(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(
            sha(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
        assert_eq!(sha(&vec![b'a'; 1_000_000]), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    }

    #[test]
    fn streaming_in_odd_chunks_matches_one_shot() {
        let data: Vec<u8> = (0..10_000u32).map(|i| (i * 31 % 251) as u8).collect();
        let mut h = Sha256::new();
        for chunk in data.chunks(37) {
            h.update(chunk);
        }
        assert_eq!(hex(&h.finish()), sha(&data));
    }

    #[test]
    fn files_are_hashed_cached_and_capped() {
        let dir = std::env::temp_dir().join(format!("sf-imagehash-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let small = dir.join("tool.exe");
        std::fs::write(&small, b"abc").unwrap();
        let big = dir.join("big.exe");
        std::fs::write(&big, vec![0u8; 2048]).unwrap();

        let mut cache = HashCache::new(2, 1024);
        let path = small.to_str().unwrap();
        let first = cache.sha256(path).unwrap();
        assert_eq!(first, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        if cfg!(windows) {
            // case-insensitive paths share one entry
            assert_eq!(cache.sha256(&path.to_uppercase()).as_deref(), Some(first.as_str()));
            assert_eq!(cache.len(), 1);
        }
        assert_eq!(cache.sha256(big.to_str().unwrap()), None, "over the cap: not hashed");
        assert_eq!(cache.sha256(dir.join("missing.exe").to_str().unwrap()), None);

        // a replaced binary (new size) is hashed again
        std::fs::write(&small, b"abcd").unwrap();
        assert_eq!(cache.sha256(path).unwrap(), "88d4266fd4e6338d13b845fcf289579d209c897823b9217da3e161936f031589");
        assert!(cache.len() <= 2);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

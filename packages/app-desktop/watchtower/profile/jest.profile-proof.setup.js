const { shimInit } = require('@joplin/lib/shim-init-node');

// The profile proof supplies its own SQLCipher database driver. Initialising
// Joplin's Node shim without stock sqlite3 keeps the proof independent from a
// second native database binding.
shimInit();

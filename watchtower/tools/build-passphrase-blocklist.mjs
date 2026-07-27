import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const sourceSha256 = '42b8ce15a02b1a22e72c1a35daa537ae1722a96373d6591e3f64a15a3a855c59';
const digestPrefixBytes = 12;
const expectedSourceEntries = 100_000;
const productContextEntries = [
	'watchtower one',
	'watchtower-one',
	'watchtower1',
	'watchtowerone',
	'watchtowerpassword',
	'watchtowervault',
];

const usage = () => {
	throw new Error(
		'Usage: node watchtower/tools/build-passphrase-blocklist.mjs ' +
		'<NCSC PwnedPasswordsTop100k.txt> <output.bin> <manifest.json>',
	);
};

const [, , inputArgument, outputArgument, manifestArgument] = process.argv;
if (!inputArgument || !outputArgument || !manifestArgument) usage();

const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
const manifestPath = resolve(manifestArgument);
const source = readFileSync(inputPath);
const actualSourceSha256 = createHash('sha256').update(source).digest('hex');
if (actualSourceSha256 !== sourceSha256) {
	throw new Error(
		`Unexpected source SHA-256: ${actualSourceSha256}; expected ${sourceSha256}`,
	);
}

const lines = source.toString('utf8').split(/\r?\n/);
const separatorIndex = lines.indexOf('--');
if (separatorIndex < 0 || lines[separatorIndex + 1] !== '') {
	throw new Error('NCSC source header separator was not found');
}
const sourceEntries = lines.slice(separatorIndex + 2);
if (sourceEntries.at(-1) === '') sourceEntries.pop();
if (sourceEntries.length !== expectedSourceEntries) {
	throw new Error(
		`Unexpected source entry count: ${sourceEntries.length}; ` +
		`expected ${expectedSourceEntries}`,
	);
}

const fullHashes = new Map();
for (const entry of [...sourceEntries, ...productContextEntries]) {
	const normalizedEntry = entry.normalize('NFC');
	const fullHash = createHash('sha256').update(normalizedEntry, 'utf8').digest();
	fullHashes.set(fullHash.toString('hex'), fullHash);
}

const sortedPrefixes = [...fullHashes.values()]
	.map(hash => hash.subarray(0, digestPrefixBytes))
	.sort(Buffer.compare);
const uniquePrefixes = sortedPrefixes.filter((prefix, index) => {
	return index === 0 || !prefix.equals(sortedPrefixes[index - 1]);
});
const blocklist = Buffer.concat(uniquePrefixes);

mkdirSync(dirname(outputPath), { recursive: true });
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(outputPath, blocklist);
writeFileSync(manifestPath, `${JSON.stringify({
	format: 'watchtower-passphrase-blocklist',
	version: 1,
	hash: 'sha256',
	digestPrefixBytes,
	entryCount: uniquePrefixes.length,
	source: {
		publisher: 'UK National Cyber Security Centre',
		title: 'Pwned Passwords Top 100k',
		originalUrl: 'https://www.ncsc.gov.uk/staticjson/static-assets/documents/PwnedPasswordsTop100k.txt',
		archivedAt: '2024-11-30T06:25:57Z',
		archiveUrl: 'https://ghostarchive.org/archive/1lgmW',
		sha256: sourceSha256,
		entryCount: sourceEntries.length,
	},
	productContextEntries,
	outputSha256: createHash('sha256').update(blocklist).digest('hex'),
}, null, '\t')}\n`);

process.stdout.write(`${JSON.stringify({
	outputPath,
	manifestPath,
	sourceEntries: sourceEntries.length,
	productContextEntries: productContextEntries.length,
	uniquePrefixes: uniquePrefixes.length,
	outputBytes: blocklist.byteLength,
})}\n`);

// node test/logbook.test.js <cosmiq-dl session dir>
// Runs the logbook downloader against a simulated Cosmiq built from captured flash data,
// with the firmware's sector-wrap bug and randomly split/merged BLE notifications.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const L = require("../logbook.js");

const dir = process.argv[2];
const hdr = [];
for (let n = 1; fs.existsSync(path.join(dir, `header_${String(n).padStart(3, "0")}.bin`)); n++)
    hdr.push([...fs.readFileSync(path.join(dir, `header_${String(n).padStart(3, "0")}.bin`))]);
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const phys = new Map();
hdr.forEach((h, i) => {
    const f = path.join(dir, `slot_${String(i + 1).padStart(3, "0")}.bin`);
    if (fs.existsSync(f) && u16(h, 30) < 256) phys.set(u16(h, 30), [...fs.readFileSync(f)]);
});

// --- unit checks ---
assert.strictEqual(L.buildReadCommand(0x40), "#40be0200\n");
assert.strictEqual(L.buildReadCommand(0x41, 1), "#41bc0201\n");
assert.strictEqual(L.buildReadCommand(0x41, 0x10), "#41ad0210\n");
assert.strictEqual(L.buildReadCommand(0x43, 1), "#43ba0201\n");
for (const c of [0x20, 0x21, 0x2b, 0x59, 0x73, 0x74]) assert.throws(() => L.buildReadCommand(c));
assert.throws(() => L.buildPacket(0x22, [NaN]));
assert.throws(() => L.buildPacket(0x22, [-1]));
assert.strictEqual(L.buildPacket(0x2e, [0x05]), "#2ecb0205\n");
assert.deepStrictEqual(L.parseLine("$40be0200").payload, [0]);
assert.throws(() => L.parseLine("$40bf0200"));
const la = new L.LineAssembler();
assert.deepStrictEqual(la.feed("$40be"), []);
assert.deepStrictEqual(la.feed("0200\n$58a6"), ["$40be0200"]);
assert.deepStrictEqual(la.feed("0200\n"), ["$58a60200"]);

// --- simulated device ---
let rng = 12345;
const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function reply(cmd, bytes) {
    const len = bytes.length * 2;
    const h = (n) => n.toString(16).toUpperCase().padStart(2, "0");
    return "$" + h(cmd) + h(L.checksum(cmd, len, bytes)) + h(len) + bytes.map(h).join("") + "\n";
}
let corruptOnce = true;
function device(line) {
    const cmd = parseInt(line.substr(1, 2), 16), arg = parseInt(line.substr(7, 2), 16);
    const out = [];
    if (cmd === 0x58) out.push(reply(0x58, [0x96]));
    else if (cmd === 0x5a) out.push(reply(0x5a, [0x70, 0x2f, 0x11, 0xfc, 0xf9, 0xf3]));
    else if (cmd === 0x40) out.push(reply(0x40, [hdr.length]));
    else if (cmd === 0x41) { out.push(reply(0x41, [36])); for (let k = 0; k < 6; k++) out.push(reply(0x42, hdr[arg - 1].slice(6 * k, 6 * k + 6))); }
    else if (cmd === 0x43) {
        const h = hdr[arg - 1], n = u16(h, 28) * 4, s = u16(h, 30);
        const buf = new Array(n).fill(0xff);
        (phys.get(s) || []).slice(0, n).forEach((b, i) => (buf[i] = b));
        out.push(reply(0x43, [n >> 8, n & 0xff]));
        for (let o = 0; o < n; o += 6) {
            let l = reply(0x44, buf.slice(o, o + 6));
            if (arg === 129 && o === 60 && corruptOnce) { corruptOnce = false; l = l.slice(0, 3) + (l[3] === "0" ? "1" : "0") + l.slice(4); }
            out.push(l);
        }
    } else throw new Error("simulator: unexpected command " + line);
    // re-chunk into BLE notifications: 1..20 bytes, ignoring line boundaries
    const stream = out.join("");
    const chunks = [];
    for (let i = 0; i < stream.length;) { const n = 1 + Math.floor(rand() * 20); chunks.push(stream.slice(i, i + n)); i += n; }
    return chunks;
}

(async () => {
    const asm = new L.LineAssembler();
    let link;
    const write = async (s) => {
        for (const c of device(s)) setTimeout(() => asm.feed(c).forEach((l) => link.onLine(l)), 0);
    };
    link = new L.CosmiqLink(write);
    const t0 = Date.now();
    const res = await L.downloadLogbook(link);
    const by = (s) => res.dives.filter((d) => d.status.startsWith(s)).length;
    console.log(res.device, `in ${Date.now() - t0} ms`);
    console.log({ complete: by("complete"), recovered: by("recovered"), partial: by("partial"),
        overwritten: by("overwritten"), unreachable: by("stored"), none: by("no profile"), bad: link.bad });
    const d37 = res.dives[36];
    assert.strictEqual(d37.status, "recovered");
    assert.strictEqual(d37.samples.length, 83);
    assert(Math.abs(Math.max(...d37.samples.map((s) => s.depth)) - d37.header.maxDepth) < 0.3);
    assert(res.dives.every((d) => d.verified));
    assert(link.bad >= 1, "corrupted line must be dropped");
    for (const d of res.dives) for (const s of d.samples) assert(s.depth < 150 && s.temp < 45, "garbage in dive " + d.index);
    const xml = L.toSubsurfaceXML(res);
    assert.strictEqual((xml.match(/<dive /g) || []).length, res.dives.length);
    // Incremental: a second download with the cache must not read any profile again,
    // and must produce the same dives.
    const cmds = [];
    const link2 = new L.CosmiqLink(async (s) => { cmds.push(s.substr(1, 2)); await write(s); });
    link = link2;
    const res2 = await L.downloadLogbook(link2, () => {}, JSON.parse(JSON.stringify(res.slotCache)));
    assert.strictEqual(cmds.filter((c) => c === "43").length, 0, "cached slots must not be re-read");
    assert.strictEqual(res2.reused, res.read);
    assert.deepStrictEqual(res2.dives.map((d) => [d.status, d.samples.length]), res.dives.map((d) => [d.status, d.samples.length]));
    // A slot whose content changed (new dive written into it) invalidates just that slot.
    const cache3 = JSON.parse(JSON.stringify(res.slotCache));
    const k = Object.keys(cache3)[0];
    delete cache3[k];
    cmds.length = 0;
    const res3 = await L.downloadLogbook(link2, () => {}, cache3);
    assert.strictEqual(res3.read, 1);
    console.log(`incremental: ${res2.reused} slots reused, 0 re-read; with one stale slot: ${res3.read} re-read`);

    // COSMIQ_DUMP=<file>: write the downloaded logbook as JSON (to seed the page for a local preview)
    if (process.env.COSMIQ_DUMP) fs.writeFileSync(process.env.COSMIQ_DUMP, JSON.stringify(res));

    const tmp = require("os").tmpdir();
    fs.writeFileSync(path.join(tmp, "cosmiq-logbook-test.xml"), xml);
    fs.writeFileSync(path.join(tmp, "cosmiq-logbook-test.csv"), L.toCSV(res));
    console.log("OK");
})().catch((e) => { console.error(e); process.exit(1); });

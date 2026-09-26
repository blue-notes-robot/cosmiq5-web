// Cosmiq logbook download + export (read-only).
//
// Protocol: ASCII hex lines. Command '#' CMD CSUM LEN ARG '\n', reply '$' CMD CSUM LEN PAYLOAD '\n',
// CSUM = (256 - (cmd + len + sum(payload bytes))) % 256, LEN = number of hex characters.
//
// Firmware bug handled here: the logger writes a profile to flash sector (start_sector % 256)
// but the 0x43 read uses start_sector unmodified. Profiles of dives stored at sector >= 256 are
// therefore only readable through the older dive whose start_sector == s - 256 (whose own
// profile has been overwritten). Dives whose physical sector no header points at can't be read.
(function (root) {
    "use strict";

    // The only commands the logbook may send. All are reads.
    const READ_ONLY = new Set([0x40, 0x41, 0x43, 0x58, 0x5a]);
    const SZ_HEADER = 36;
    const WRAP = 256;

    const hex2 = (n) => n.toString(16).padStart(2, "0");

    function checksum(cmd, len, bytes) {
        const sum = bytes.reduce((a, b) => a + b, cmd + len);
        return (256 - (sum % 256)) % 256;
    }

    // Build a command line from a byte payload (used by settings writes too).
    function buildPacket(cmd, bytes) {
        if (!Number.isInteger(cmd) || cmd < 0 || cmd > 0xff) throw new Error("bad command");
        for (const b of bytes)
            if (!Number.isInteger(b) || b < 0 || b > 0xff) throw new Error("bad payload byte " + b);
        const len = bytes.length * 2;
        return "#" + hex2(cmd) + hex2(checksum(cmd, len, bytes)) + hex2(len) + bytes.map(hex2).join("") + "\n";
    }

    function buildReadCommand(cmd, arg = 0) {
        if (!READ_ONLY.has(cmd)) throw new Error("command 0x" + hex2(cmd) + " is not a logbook read");
        if (!Number.isInteger(arg) || arg < 0 || arg > 0xff) throw new Error("argument out of range");
        return buildPacket(cmd, [arg]);
    }

    // Parse one reply line (without '\n'). Returns {cmd, payload:[bytes], text} or throws.
    function parseLine(line) {
        if (line[0] !== "$") throw new Error("bad start: " + line);
        const t = line.slice(1).replace(/\r$/, "");
        if (t.length < 6 || !/^[0-9A-Fa-f]+$/.test(t)) throw new Error("not hex: " + line);
        const cmd = parseInt(t.substr(0, 2), 16);
        const cs = parseInt(t.substr(2, 2), 16);
        const len = parseInt(t.substr(4, 2), 16);
        const ph = t.slice(6);
        if (ph.length !== len || len % 2) throw new Error("length mismatch: " + line);
        const payload = [];
        for (let i = 0; i < ph.length; i += 2) payload.push(parseInt(ph.substr(i, 2), 16));
        if (checksum(cmd, len, payload) !== cs) throw new Error("checksum mismatch: " + line);
        return { cmd, payload, text: t.toUpperCase() };
    }

    // Joins BLE notifications into '\n'-terminated lines.
    class LineAssembler {
        constructor() { this.buf = ""; }
        feed(text) {
            this.buf += text;
            const lines = [];
            let i;
            while ((i = this.buf.indexOf("\n")) >= 0) {
                let l = this.buf.slice(0, i);
                this.buf = this.buf.slice(i + 1);
                const j = l.lastIndexOf("$");
                if (j > 0) l = l.slice(j);
                if (l) lines.push(l);
            }
            if (this.buf.length > 256) this.buf = ""; // never grow without bound on junk
            return lines;
        }
        reset() { this.buf = ""; }
    }

    const u16 = (b, o) => b[o] | (b[o + 1] << 8);

    function modelName(fw) {
        return ({ 0: "COSMIQ", 1: "COSMIQ+", 2: "COSMIQ 5" })[fw >> 6] || "Cosmiq";
    }

    // 36-byte header, layout from the Deepblu app (CosmiqLogHeader.java).
    function parseHeader(h) {
        const mode = h[2];
        const dvsetting = u16(h, 4);
        const surface = dvsetting === 0x80b4 ? 1000 : dvsetting & 0x1fff;
        const reserved = u16(h, 20);
        const salt = reserved & 1;
        const dvtime = u16(h, 12);
        return {
            logNumber: u16(h, 0),
            mode: mode === 4 ? "freedive" : mode === 3 ? "gauge" : "scuba",
            o2: h[3],
            surface,
            salt,
            year: u16(h, 6), day: h[8], month: h[9], minute: h[10], hour: h[11],
            divetime: mode === 4 ? dvtime : dvtime * 60,
            maxDepth: depth(u16(h, 22), surface, salt),
            minTemp: u16(h, 24) / 10,
            interval: mode === 4 ? 1 : 20, // the app hard-codes this
            nsamples: u16(h, 28),
            startSector: u16(h, 30),
        };
    }

    function depth(p, surface, salt) {
        return (p - surface) / (salt ? 102.5 : 100);
    }

    // Samples: u16le temperature (0.1 C), u16le absolute pressure (mbar). Trimmed to the dive time.
    function parseSamples(hdr, body) {
        const out = [];
        for (let k = 0; k + 4 <= body.length; k += 4) {
            const t = (k / 4 + 1) * hdr.interval;
            if (t > hdr.divetime) break;
            out.push({ time: t, depth: depth(u16(body, k + 2), hdr.surface, hdr.salt), temp: u16(body, k) / 10 });
        }
        return out;
    }

    // Which dive index (0-based) returns the samples of dive i, or -1 plus a reason.
    function profileSlot(headers, i) {
        const s = headers[i].startSector;
        for (let j = 0; j < headers.length; j++) {
            const o = headers[j].startSector;
            if (s >= WRAP && o === s - WRAP) return { slot: j };
            if (s < WRAP && o === s + WRAP) return { slot: -1, reason: "overwritten by a newer dive" };
        }
        if (s >= WRAP) return { slot: -1, reason: "stored in an unreachable sector" };
        return { slot: i };
    }

    function stripErased(body) {
        let n = body.length - (body.length % 4);
        while (n >= 4 && body[n - 1] === 0xff && body[n - 2] === 0xff && body[n - 3] === 0xff && body[n - 4] === 0xff) n -= 4;
        return body.slice(0, n);
    }

    // Request/response over a line-based transport. write(str) sends one command line.
    class CosmiqLink {
        constructor(write, log = () => {}) {
            this.write = write;
            this.log = log;
            this.waiter = null;
            this.bad = 0;
        }
        // Feed one assembled reply line.
        onLine(line) {
            let pkt;
            try { pkt = parseLine(line); } catch (e) { this.bad++; this.log("dropped: " + e.message); return; }
            if (this.waiter) this.waiter.push(pkt);
        }
        // Send cmd/arg, collect packets until done(list) or idleMs of silence.
        async transact(cmd, arg, done, idleMs = 3000) {
            const got = [];
            let wake = null;
            this.waiter = { push: (p) => { got.push(p); if (wake) wake(); } };
            try {
                await this.write(buildReadCommand(cmd, arg));
                while (!done(got)) {
                    const n = got.length;
                    await new Promise((r) => { wake = r; setTimeout(r, idleMs); });
                    wake = null;
                    if (got.length === n) break; // idle timeout
                }
            } finally {
                this.waiter = null;
            }
            return got;
        }
        async query(cmd) {
            const got = await this.transact(cmd, 0, (g) => g.some((p) => p.cmd === cmd));
            const p = got.find((p) => p.cmd === cmd);
            if (!p) throw new Error("no reply to 0x" + hex2(cmd));
            return p.payload;
        }
        async header(n) {
            const got = await this.transact(0x41, n, (g) => g.filter((p) => p.cmd === 0x42).length >= 6);
            const data = [].concat(...got.filter((p) => p.cmd === 0x42).map((p) => p.payload));
            if (data.length !== SZ_HEADER) throw new Error("header " + n + ": got " + data.length + " bytes");
            return data;
        }
        async profileOnce(n, nbytes) {
            const got = await this.transact(0x43, n, (g) => g.filter((p) => p.cmd === 0x44).reduce((a, p) => a + p.payload.length, 0) >= nbytes);
            return [].concat(...got.filter((p) => p.cmd === 0x44).map((p) => p.payload));
        }
        // Read until two complete copies agree.
        async profile(n, nbytes, attempts = 4) {
            const seen = [];
            let last = [];
            for (let a = 0; a < attempts; a++) {
                const bad = this.bad;
                last = await this.profileOnce(n, nbytes);
                if (last.length !== nbytes || this.bad !== bad) continue;
                const key = last.join(",");
                if (seen.includes(key)) return { data: last, verified: true };
                seen.push(key);
            }
            return { data: last, verified: false };
        }
    }

    const toHex = (bytes) => bytes.map(hex2).join("");

    // A slot's flash content only changes when a newer dive is written into it, which also adds a
    // new header pointing at it. So the headers of the slot and of the dive stored in it identify
    // the content: if both are unchanged, a previously verified copy is still valid.
    function slotKey(raw, headers, j) {
        const into = headers.findIndex((_, i) => i !== j && profileSlot(headers, i).slot === j);
        return toHex(raw[j]) + (into >= 0 ? "|" + toHex(raw[into]) : "");
    }

    // Full read-only logbook download. progress(text, fraction).
    // slotCache: optional {key: {data, verified}} from a previous download; only slots whose
    // content may have changed are read again. The returned result carries the updated cache.
    async function downloadLogbook(link, progress = () => {}, slotCache = {}) {
        const fw = (await link.query(0x58))[0];
        const mac = await link.query(0x5a);
        const count = parseInt((await link.query(0x40)).map(hex2).join(""), 16) || 0;
        const device = { fw, model: modelName(fw), version: (fw & 0x3f) / 10, mac: mac.slice().reverse().map(hex2).join(":").toUpperCase(), count };
        const raw = [], headers = [];
        for (let n = 1; n <= count; n++) {
            progress(`Reading header ${n}/${count}`, (0.3 * n) / count);
            const h = await link.header(n);
            raw.push(h);
            headers.push(parseHeader(h));
        }
        // Read every slot that holds written data, once each, reusing verified cached copies.
        const slots = new Map();
        const newCache = {};
        const needed = [...new Set(headers.map((_, i) => profileSlot(headers, i).slot).filter((s) => s >= 0))]
            .filter((j) => headers[j].nsamples > 0);
        const toRead = needed.filter((j) => {
            const c = slotCache[slotKey(raw, headers, j)];
            return !(c && c.verified && c.data.length === headers[j].nsamples * 4);
        });
        let done = 0;
        for (const j of needed) {
            const key = slotKey(raw, headers, j);
            if (!toRead.includes(j)) {
                slots.set(j, slotCache[key]);
            } else {
                progress(`Reading profile ${++done}/${toRead.length}`, 0.3 + (0.7 * done) / Math.max(1, toRead.length));
                slots.set(j, await link.profile(j + 1, headers[j].nsamples * 4));
            }
            newCache[key] = slots.get(j);
        }
        const dives = headers.map((hdr, i) => {
            const { slot, reason } = profileSlot(headers, i);
            const need = hdr.nsamples * 4;
            let body = [], status = reason || "", verified = true;
            if (slot >= 0 && need && !slots.has(slot)) {
                status = "stored in an unreachable sector"; // the slot's own header has no samples
            } else if (slot >= 0 && need) {
                const s = slots.get(slot);
                body = stripErased(s.data.slice(0, need));
                verified = s.verified;
                if (slot === i) status = "complete";
                else status = body.length >= need ? "recovered" : `partial (${body.length / 4}/${hdr.nsamples} samples)`;
            } else if (!need && !reason) status = "no profile recorded";
            const samples = parseSamples(hdr, body);
            return { index: i + 1, header: hdr, raw: raw[i], body, samples, status, verified };
        });
        progress("Done", 1);
        return { device, dives, slotCache: newCache, reused: needed.length - toRead.length, read: toRead.length };
    }

    // ---- export ----
    const pad = (n, w = 2) => String(n).padStart(w, "0");
    const mmss = (s) => `${Math.floor(s / 60)}:${pad(s % 60)} min`;
    const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);

    function toSubsurfaceXML(result) {
        const model = "Deepblu " + result.device.model;
        const out = ['<divelog program="cosmiq5-web" version="3">', "<dives>"];
        const dives = result.dives.slice().sort((a, b) => a.header.logNumber - b.header.logNumber);
        for (const d of dives) {
            const h = d.header;
            out.push(`<dive number="${h.logNumber}" date="${h.year}-${pad(h.month)}-${pad(h.day)}" time="${pad(h.hour)}:${pad(h.minute)}:00" duration="${mmss(h.divetime)}">`);
            if (d.status !== "complete" && d.status !== "recovered") out.push(`<notes>${esc("Profile: " + d.status)}</notes>`);
            if (h.mode === "scuba" && h.o2) out.push(`<cylinder o2="${h.o2}.0%" />`);
            out.push(`<divecomputer model="${esc(model)}"${h.mode === "freedive" ? ' dctype="Freedive"' : ""}>`);
            const maxd = Math.max(h.maxDepth, ...d.samples.map((s) => s.depth));
            out.push(`<depth max="${maxd.toFixed(1)} m" />`);
            const tmin = d.samples.length ? Math.min(...d.samples.map((s) => s.temp)) : h.minTemp < 100 ? h.minTemp : null;
            if (tmin !== null) out.push(`<temperature water="${tmin.toFixed(1)} C" />`);
            out.push(`<surface pressure="${(h.surface / 1000).toFixed(3)} bar" />`);
            out.push(`<water salinity="${h.salt ? 1030 : 1000} g/l" />`);
            if (d.samples.length) out.push('<sample time="0:00 min" depth="0.0 m" />');
            for (const s of d.samples)
                out.push(`<sample time="${mmss(s.time)}" depth="${Math.max(s.depth, 0).toFixed(2)} m" temp="${s.temp.toFixed(1)} C" />`);
            out.push("</divecomputer>", "</dive>");
        }
        out.push("</dives>", "</divelog>");
        return out.join("\n") + "\n";
    }

    function toCSV(result) {
        const rows = ["dive,log_number,date,mode,status,time_s,depth_m,temp_c"];
        for (const d of result.dives) {
            const h = d.header;
            const date = `${h.year}-${pad(h.month)}-${pad(h.day)} ${pad(h.hour)}:${pad(h.minute)}`;
            for (const s of d.samples)
                rows.push([d.index, h.logNumber, date, h.mode, `"${d.status}"`, s.time, s.depth.toFixed(2), s.temp.toFixed(1)].join(","));
        }
        return rows.join("\n") + "\n";
    }

    // Raw dump (header + recovered samples per dive, libdivecomputer layout) for bug reports.
    function toRawJSON(result) {
        return JSON.stringify({ device: result.device, dives: result.dives.map((d) => ({
            index: d.index, status: d.status, verified: d.verified,
            header: d.raw.map(hex2).join(""), profile: d.body.map(hex2).join(""),
        })) }, null, 1);
    }

    const api = { buildPacket, buildReadCommand, parseLine, LineAssembler, modelName, parseHeader, parseSamples, profileSlot,
        stripErased, CosmiqLink, downloadLogbook, toSubsurfaceXML, toCSV, toRawJSON, checksum };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.CosmiqLogbook = api;
})(typeof window !== "undefined" ? window : globalThis);

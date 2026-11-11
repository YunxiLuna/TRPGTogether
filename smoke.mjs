import { spawn } from "node:child_process";
import http from "node:http";

const child = spawn("node", ["dist/server/index.js"], {
  cwd: "D:\\WORK\\TRPGTogether",
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => process.stdout.write(d));
child.stderr.on("data", (d) => process.stderr.write(d));

function get(u) {
  return new Promise((res, rej) => {
    http.get(u, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => res({ status: r.statusCode, body: d }));
    }).on("error", rej);
  });
}
function post(u, b) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(b);
    const req = http.request(
      u,
      { method: "POST", headers: { "Content-Type": "application/json", ContentLength: Buffer.byteLength(data) } },
      (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res({ status: r.statusCode, body: d }));
      },
    );
    req.on("error", rej);
    req.write(data);
    req.end();
  });
}

setTimeout(async () => {
  try {
    const root = await get("http://127.0.0.1:54272/");
    console.log("ROOT:", root.status, root.body.slice(0, 300));
    const st = await post("http://127.0.0.1:54272/api/settle", { actor: "A", fact_ref: "突破成功率", inputs: { 悟性: 100, 气运: 50, 体魄: 200 } });
    console.log("SETTLE:", st.status, st.body.slice(0, 300));
    const pa = await get("http://127.0.0.1:54272/api/panel/A");
    console.log("PANEL:", pa.status, pa.body.slice(0, 400));
    const bb = await get("http://127.0.0.1:54272/api/briefing/B");
    console.log("BRIEFING:", bb.status, bb.body.slice(0, 300));
    const lg = await get("http://127.0.0.1:54272/api/ledger");
    const parsed = JSON.parse(lg.body);
    console.log("LEDGER: events=" + parsed.events.length + " seq=" + parsed.seqCounter);
  } catch (e) {
    console.error("FAIL:", e);
  }
  child.kill();
  process.exit(0);
}, 3000);

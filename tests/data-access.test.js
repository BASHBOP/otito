import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractDataAccess, generateCodeMap } from "../src/lib/code-map.js";
import { generateDataAccessReport } from "../src/lib/data-access.js";

test("extractDataAccess catches SELECT/INSERT/UPDATE/DELETE with table names", () => {
  const text = [
    'var q1 = "SELECT * FROM users WHERE id = 1";',
    'var q2 = "INSERT INTO bookings (id, owner) VALUES (1, 2)";',
    'var q3 = "UPDATE carOwner SET MyPoints = MyPoints + 200 WHERE ownerID = 1";',
    'var q4 = "DELETE FROM schedule WHERE id = 5";',
  ].join("\n");

  const hits = extractDataAccess(text);
  const byOp = Object.fromEntries(hits.map((h) => [h.op, h.table]));
  assert.equal(byOp.SELECT, "users");
  assert.equal(byOp.INSERT, "bookings");
  assert.equal(byOp.UPDATE, "carOwner");
  assert.equal(byOp.DELETE, "schedule");
});

test("extractDataAccess skips standalone SQL words that aren't real queries", () => {
  const text = [
    'var a = "select";',
    'var b = "select-one";',
    'var c = "SELECT";',
    'var d = "INSERT";',
    'var e = "UPDATE the docs";',
    'var realQuery = "SELECT id FROM users";',
  ].join("\n");

  const hits = extractDataAccess(text);
  assert.equal(hits.length, 1, "only the real SQL with FROM should match");
  assert.equal(hits[0].table, "users");
});

test("extractDataAccess handles strings containing single quotes (WASHD-style)", () => {
  const text = `string sql = "DELETE FROM schedule WHERE id = '" + bookingId + "'";`;
  const hits = extractDataAccess(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].op, "DELETE");
  assert.equal(hits[0].table, "schedule");
});

test('extractDataAccess handles C# verbatim strings (@"...")', () => {
  const text = `var sql = @"UPDATE carOwner SET MyPoints = MyPoints+200 WHERE Email = 'x@y.com'";`;
  const hits = extractDataAccess(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].op, "UPDATE");
  assert.equal(hits[0].table, "carOwner");
});

test("extractDataAccess handles Python triple-strings", () => {
  const text = ['sql = """', "SELECT u.id, u.email", "FROM users u", "WHERE u.active = true", '"""'].join("\n");
  const hits = extractDataAccess(text);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].op, "SELECT");
  assert.equal(hits[0].table, "users");
});

test("extractDataAccess detects Prisma ORM calls", () => {
  const text = [
    "await prisma.booking.findUnique({ where: { id: 1 } });",
    "const b = await prisma.carOwner.create({ data: { email } });",
    "await db.user.updateMany({ where: {}, data: {} });",
    "await tx.pointsLedger.deleteMany({ where: { ownerId: 1 } });",
  ].join("\n");

  const hits = extractDataAccess(text);
  assert.equal(hits.length, 4);
  const byTable = hits.reduce((acc, h) => ({ ...acc, [h.table]: h.op }), {});
  assert.equal(byTable.booking, "findUnique");
  assert.equal(byTable.carOwner, "create");
  assert.equal(byTable.user, "updateMany");
  assert.equal(byTable.pointsLedger, "deleteMany");
});

test("generateCodeMap propagates dataAccess to file records and aggregates summary", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "data-access-map-"));
  fs.writeFileSync(
    path.join(root, "service.ts"),
    [
      'import { db } from "./db";',
      "export async function listBookings() {",
      '  return db.query("SELECT * FROM bookings WHERE active = true");',
      "}",
      "export async function cancelBooking(id: number) {",
      '  await db.query("DELETE FROM bookings WHERE id = $1", [id]);',
      "}",
      "",
    ].join("\n"),
  );

  const map = generateCodeMap(root);
  const file = map.files.find((f) => f.path === "service.ts");
  assert.ok(file.dataAccess, "dataAccess should be present");
  assert.equal(file.dataAccess.length, 2);
  assert.equal(map.summary.dataAccessFiles, 1);
  assert.equal(map.summary.dataAccessHits, 2);
});

test("generateCodeMap suppresses dataAccess on vendor files (no false positives in minified JS)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "data-access-vendor-"));
  fs.mkdirSync(path.join(root, "js"), { recursive: true });
  fs.writeFileSync(path.join(root, "js", "angular.min.js"), 'a.select("foo");b.SELECT="WHERE";c="UPDATE INTO";var d="SELECT * FROM users";');

  const map = generateCodeMap(root);
  const file = map.files.find((f) => f.path === "js/angular.min.js");
  assert.equal(file.isVendor, true);
  assert.equal(file.dataAccess, undefined, "vendor files should have no dataAccess");
});

test("generateDataAccessReport returns aggregated structure + markdown", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "data-access-report-"));
  fs.writeFileSync(path.join(root, "a.ts"), 'const x = "SELECT * FROM users WHERE id=1"; const y = "INSERT INTO orders VALUES (1)";');
  fs.writeFileSync(path.join(root, "b.ts"), 'const z = "DELETE FROM users WHERE id=1";');

  const { data, markdown } = generateDataAccessReport(root);
  assert.equal(data.summary.totalHits, 3);
  assert.equal(data.summary.filesWithHits, 2);
  assert.equal(data.summary.operations, 3);
  assert.equal(data.summary.tables, 2);
  assert.ok(data.byTable.some((row) => row.key === "users" && row.count === 2));
  assert.ok(data.byOp.some((row) => row.key === "SELECT"));
  assert.match(markdown, /# Data-Access Surface/);
  assert.match(markdown, /## By Operation/);
  assert.match(markdown, /## By Table/);
});

/** Pure-function guards for the isolated verify run's `.env` / JDBC URL handling (HEL-1297). */

import { dedicatedUrl, parseDatabaseUrl, parseDotEnv } from "./isolatedDb.js";

describe("parseDotEnv", () => {
  it("reads KEY=VALUE lines like build.sbt's loadDotEnv and skips comments/blank lines", () => {
    const env = parseDotEnv("# c\n\nA=1\n B = two=2 \nnoequals\n=x\n");
    expect(env).toEqual({ A: "1", B: "two=2" });
  });
});

describe("parseDatabaseUrl / dedicatedUrl", () => {
  it("takes user/password from the query string and keeps it when the database name is swapped", () => {
    const conn = parseDatabaseUrl({
      DATABASE_URL: "jdbc:postgresql://db.local:5544/helio?user=u%40x&password=p%26w",
    });
    expect(conn).toMatchObject({ host: "db.local", port: "5544", user: "u@x", password: "p&w" });
    expect(dedicatedUrl(conn, "helio_verify_ab12")).toBe(
      "jdbc:postgresql://db.local:5544/helio_verify_ab12?user=u%40x&password=p%26w",
    );
  });

  it("falls back to userinfo, then DB_USER/DB_PASSWORD, and to the default port", () => {
    expect(parseDatabaseUrl({ DATABASE_URL: "jdbc:postgresql://me:pw@h/helio" })).toMatchObject({
      host: "h",
      port: "5432",
      user: "me",
      password: "pw",
    });
    expect(
      parseDatabaseUrl({
        DATABASE_URL: "jdbc:postgresql://h/helio",
        DB_USER: "a",
        DB_PASSWORD: "b",
      }),
    ).toMatchObject({ user: "a", password: "b" });
  });

  it("rejects a non-postgres JDBC URL", () => {
    expect(() => parseDatabaseUrl({ DATABASE_URL: "jdbc:mysql://h/x" })).toThrow(/DATABASE_URL/);
    expect(() => parseDatabaseUrl({})).toThrow(/DATABASE_URL/);
  });
});

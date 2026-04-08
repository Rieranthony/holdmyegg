import { describe, expect, it } from "vitest";
import {
  avatarModeEnum,
  matchOutcomeEnum,
  participantJoinModeEnum,
  schema
} from "./schema";

describe("db schema", () => {
  it("exposes the Better Auth core tables and app tables", () => {
    expect(schema.user).toBeDefined();
    expect(schema.session).toBeDefined();
    expect(schema.account).toBeDefined();
    expect(schema.verification).toBeDefined();
    expect(schema.playerProfiles).toBeDefined();
    expect(schema.playerLifetimeStats).toBeDefined();
    expect(schema.matches).toBeDefined();
    expect(schema.matchParticipants).toBeDefined();
  });

  it("locks avatar and match enums to the expected v1 values", () => {
    expect(avatarModeEnum.enumValues).toEqual(["facehash", "custom"]);
    expect(matchOutcomeEnum.enumValues).toEqual(["winner", "timeout", "abandoned"]);
    expect(participantJoinModeEnum.enumValues).toEqual(["active", "waiting", "spectator"]);
  });
});

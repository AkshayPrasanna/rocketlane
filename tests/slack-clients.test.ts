import { describe, expect, it } from "vitest";
import { dealMarker } from "@/lib/communication/messages";
import { IntegrationError } from "@/lib/integrations/errors";
import { MockSlackClient } from "@/lib/integrations/slack/mock";
import { SimulatedSlackClient } from "@/lib/integrations/slack/simulated";
import type { SlackClient } from "@/lib/integrations/slack/types";
import { createMemoryStore } from "@/lib/store/get-store";
import { FIXED_NOW } from "./helpers/harness";

/** The same behaviour is required of the in-memory mock and the persisted simulation. */
const IMPLEMENTATIONS: [string, () => SlackClient][] = [
  ["MockSlackClient", () => new MockSlackClient()],
  [
    "SimulatedSlackClient",
    () => {
      let n = 0;
      return new SimulatedSlackClient(createMemoryStore().slack, {
        clock: () => FIXED_NOW,
        newId: () => `id-${++n}-abcdef`,
      });
    },
  ],
];

describe.each(
  IMPLEMENTATIONS
)("%s honours the SlackClient contract", (_name, make) => {
  it("creates a channel and finds it by name", async () => {
    const slack = make();

    const created = await slack.createChannel("onb-acme-enterprise");
    const found = await slack.findChannelByName("onb-acme-enterprise");

    expect(created.channelName).toBe("onb-acme-enterprise");
    expect(found?.channelId).toBe(created.channelId);
  });

  it("raises a conflict when the name is taken, like Slack's name_taken", async () => {
    const slack = make();
    await slack.createChannel("onb-acme-enterprise");

    const error = await slack
      .createChannel("onb-acme-enterprise")
      .catch((e) => e);

    expect(error).toBeInstanceOf(IntegrationError);
    expect(error.kind).toBe("conflict");
    expect(error.retryable).toBe(false);
  });

  it("returns null for a channel that does not exist", async () => {
    expect(await make().findChannelByName("nope")).toBeNull();
  });

  it("stores the purpose so a retry can recognise its own channel", async () => {
    const slack = make();
    const { channelId } = await slack.createChannel("onb-acme-growth");

    await slack.setPurpose(channelId, `for Acme ${dealMarker("msg-1")}`);

    const found = await slack.findChannelByName("onb-acme-growth");
    expect(found?.purpose).toContain("[deal:msg-1]");
  });

  it("posts messages and reports the invite as simulated", async () => {
    const slack = make();
    const { channelId } = await slack.createChannel("onb-acme-growth");

    await slack.setTopic(channelId, "Acme onboarding");
    const post = await slack.postMessage(channelId, "Welcome!");
    const invite = await slack.inviteExternalUser(channelId, "jane@acme.com");

    expect(post.ts.length).toBeGreaterThan(0);
    expect(invite.status).toBe("simulated");
  });
});

describe("SimulatedSlackClient persistence", () => {
  function setup() {
    const store = createMemoryStore();
    let n = 0;
    const slack = new SimulatedSlackClient(store.slack, {
      clock: () => FIXED_NOW,
      newId: () => `id-${++n}-abcdef`,
    });
    return { slack, store };
  }

  it("records channels, topics, messages and invites where the dashboard can read them", async () => {
    const { slack, store } = setup();
    const { channelId } = await slack.createChannel("onb-acme-enterprise");
    await slack.setTopic(channelId, "Acme onboarding");
    await slack.postMessage(channelId, "Welcome!");
    await slack.inviteExternalUser(channelId, "jane@acme.com");

    expect((await store.slack.getChannel(channelId))?.topic).toBe(
      "Acme onboarding"
    );
    expect(
      (await store.slack.listMessages(channelId)).map((m) => m.text)
    ).toEqual(["Welcome!"]);
    expect(await store.slack.listInvites(channelId)).toHaveLength(1);
  });

  it("creates an alert channel such as ops-escalations on first use", async () => {
    const { slack, store } = setup();

    await slack.postMessage("ops-escalations", "Onboarding needs a human");

    expect((await store.slack.getChannel("ops-escalations"))?.name).toBe(
      "ops-escalations"
    );
    expect(await store.slack.listMessages("ops-escalations")).toHaveLength(1);
  });

  it("keeps two simultaneous creations of one name from both succeeding", async () => {
    const { slack } = setup();

    const results = await Promise.allSettled([
      slack.createChannel("onb-acme-growth"),
      slack.createChannel("onb-acme-growth"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

import { channels, getWelcomeChannel } from "./channels";
import { config } from "./config";
import { createLogger } from "./logger";
import { getSlackClient } from "./slack";
import { logAction } from "./store";

const logger = createLogger("welcome");

/** Edit this to match your community's voice. */
function buildWelcomeMessage(userId: string): string {
  const channelList = Object.values(channels)
    .map((ch) => `• *#${ch.name}* — ${ch.description}`)
    .join("\n");

  return [
    `Welcome to ${config.communityName}, <@${userId}>! :wave:`,
    "",
    "Here are some channels to get you started:",
    channelList,
    "",
    `Feel free to introduce yourself here and ask questions anytime. We're glad you're here!`,
  ].join("\n");
}

export async function handleMemberJoined(event: {
  user: string;
  channel: string;
}): Promise<void> {
  const welcomeChannel = getWelcomeChannel();
  if (!welcomeChannel) {
    return;
  }

  const slack = getSlackClient();

  try {
    const info = await slack.conversations.info({ channel: event.channel });
    if (info.channel?.name !== welcomeChannel.name) {
      return;
    }
  } catch {
    logger.error("Failed to resolve channel", { channel: event.channel });
    return;
  }

  try {
    await slack.chat.postMessage({
      channel: event.channel,
      text: buildWelcomeMessage(event.user),
    });
    let userName = event.user;
    try {
      const userInfo = await slack.users.info({ user: event.user });
      userName =
        userInfo.user?.profile?.display_name ||
        userInfo.user?.real_name ||
        userInfo.user?.name ||
        event.user;
    } catch {
      // Fall back to raw user ID
    }

    logger.info("Welcome message sent", {
      user: userName,
      channel: event.channel,
    });
    await logAction({
      type: "welcomed",
      channel: `#${welcomeChannel.name}`,
      user: userName,
      description: "Welcomed new member to the community",
    });
  } catch (error) {
    logger.error("Failed to handle welcome", { error: String(error) });
  }
}

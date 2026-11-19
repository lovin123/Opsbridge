/**
 * Chat media uses Nexconn Helper upload paths, not Cloudinary.
 * Per Nexconn docs, GroupChannel/DirectChannel constructors are the send path.
 */
export async function sendChatImage(channelId: string, file: File, mode: "group" | "direct") {
  const chat = await import("@nexconn/chat");
  const channel =
    mode === "group" ? new chat.GroupChannel(channelId) : new chat.DirectChannel(channelId);
  const prepared = await chat.Helper.createSendImageMessageParams(file);
  if (!prepared.isOk || !prepared.data) {
    throw new Error(prepared.msg || "Could not prepare the image message");
  }
  const sent = await channel.sendMediaMessage(prepared.data);
  if (sent.code !== 0) {
    throw new Error(sent.msg || "Could not send the image message");
  }
  return sent.data;
}

export function buildPublicName(from) {
  const joined = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  return joined || from?.username || `user-${from?.id ?? "unknown"}`;
}

export function slugify(value) {
  return String(value || "unknown")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "unknown";
}

export function buildSessionKey(user, index) {
  if (index === 0) {
    return `tg_${user.telegramUserId}`;
  }

  return `tg${index}_${user.telegramUserId}_${slugify(user.publicName)}`;
}

export function buildSessionLabel(user, index) {
  if (index === 0) {
    return `Default chat for ${user.publicName}`;
  }

  return `Chat ${index} for ${user.publicName}`;
}

export function chunkText(text, limit = 3900) {
  const value = String(text ?? "");

  if (value.length <= limit) {
    return [value];
  }

  const chunks = [];
  let remaining = value;

  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit / 2) {
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt < limit / 2) {
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

export function formatDateTime(value) {
  if (!value) {
    return "n/a";
  }

  return new Date(value).toLocaleString();
}

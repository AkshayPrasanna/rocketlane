/**
 * NovaCRM inbox bridge.
 *
 * Runs inside the CS Gmail account on a one-minute trigger and does two things:
 *   1. Sends the replies the app has queued (as threaded replies from this account).
 *   2. Forwards new deal emails to the app, then labels them as processed.
 *
 * Setup is in docs/gmail-setup.md. Configuration lives in Script properties
 * (Project Settings -> Script properties), never in this file:
 *   APP_URL        https://<your-app>.vercel.app          (no trailing slash needed)
 *   BRIDGE_SECRET  the same value as GMAIL_BRIDGE_SECRET in the app
 *   VERCEL_BYPASS  optional: Vercel "Protection Bypass for Automation" secret
 *   QUERY          optional: override the Gmail search below
 */

var PROCESSED_LABEL = "novacrm-processed";
var DEFAULT_QUERY = 'in:inbox -from:me newer_than:2d subject:"deal closed" -label:' + PROCESSED_LABEL;
var MAX_THREADS = 10;
var SENT_MEMORY = 200;

/** The trigger entry point. */
function run() {
  var cfg = config_();
  sendQueuedReplies_(cfg);
  forwardNewEmails_(cfg);
}

/** Run this once: it asks for permission and creates the one-minute trigger. */
function install() {
  config_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "run") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("run").timeBased().everyMinutes(1).create();
  Logger.log("Installed: run() will execute every minute.");
}

/**
 * Run this if check() fails with HTTP 401. It prints a short fingerprint of BRIDGE_SECRET, never
 * the secret itself. On your computer, run:
 *   set -a; source .env.local; set +a; printf %s "$GMAIL_BRIDGE_SECRET" | shasum -a 256 | cut -c1-8
 * If the two fingerprints differ, this script's secret is wrong. If they match, the value on
 * Vercel is wrong or Vercel has not been redeployed since you set it.
 */
function debug() {
  var cfg = config_();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, cfg.secret);
  var hex = digest.map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join("");
  Logger.log("APP_URL: " + cfg.appUrl);
  Logger.log("BRIDGE_SECRET length: " + cfg.secret.length + " (the generated secret is 48 characters)");
  Logger.log("BRIDGE_SECRET fingerprint: " + hex.slice(0, 8));
}

/** Run this to confirm the app is reachable and the secret is right. Expect "OK". */
function check() {
  var cfg = config_();
  var res = call_(cfg, "get", "/api/gmail/outbox", null);
  Logger.log("OK. Pending replies at the app: " + res.replies.length);
}

// ---------------------------------------------------------------- inbound

function forwardNewEmails_(cfg) {
  var me = Session.getEffectiveUser().getEmail().toLowerCase();
  var threads = GmailApp.search(cfg.query, 0, MAX_THREADS);
  if (threads.length === 0) return;

  var messages = [];
  var threadOf = {};
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var from = parseFrom_(msg.getFrom());
      if (from.email === me) return; // our own replies are never deal emails
      var payload = {
        id: msg.getId(),
        threadId: thread.getId(),
        from: from,
        subject: msg.getSubject(),
        bodyText: msg.getPlainBody(),
        receivedAt: msg.getDate().toISOString(),
        rfc822MessageId: msg.getHeader("Message-ID") || null,
        senderAuthentication: authentication_(msg.getHeader("Authentication-Results")),
        generatedByAgent: false,
        labelIds: ["INBOX"],
      };
      messages.push(payload);
      threadOf[payload.id] = thread;
    });
  });
  if (messages.length === 0) return;

  var res = call_(cfg, "post", "/api/gmail/ingest", { messages: messages });
  var label = GmailApp.getUserLabelByName(PROCESSED_LABEL) || GmailApp.createLabel(PROCESSED_LABEL);
  var failedThreads = {};
  res.results.forEach(function (r) {
    if (r.status === "error") {
      failedThreads[threadOf[r.id].getId()] = true;
      Logger.log("App could not process " + r.id + ": " + r.error);
    }
  });
  // Label only threads where every message was accepted, so failures are retried next minute.
  threads.forEach(function (thread) {
    if (!failedThreads[thread.getId()]) thread.addLabel(label);
  });
}

/** "Ravi Kumar <ravi@x.com>" or "ravi@x.com" -> { email, name }. */
function parseFrom_(raw) {
  var match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(raw);
  if (match) {
    return { email: match[2].trim().toLowerCase(), name: match[1].trim() || null };
  }
  return { email: String(raw).trim().toLowerCase(), name: null };
}

/**
 * Gmail records whether DKIM, SPF and DMARC passed in Authentication-Results. A pass means the
 * From address was not forged; an explicit result with no pass means it may have been.
 */
function authentication_(header) {
  if (!header) return "unknown";
  var h = header.toLowerCase();
  if (/(dmarc|dkim|spf)=pass/.test(h)) return "pass";
  if (/(dmarc|dkim|spf)=(fail|softfail|none|neutral|permerror)/.test(h)) return "fail";
  return "unknown";
}

// ---------------------------------------------------------------- outbound

function sendQueuedReplies_(cfg) {
  var res = call_(cfg, "get", "/api/gmail/outbox", null);
  if (res.replies.length === 0) return;

  var props = PropertiesService.getScriptProperties();
  var sent = JSON.parse(props.getProperty("SENT_IDS") || "[]");
  var done = [];

  res.replies.forEach(function (reply) {
    // Remembering sent IDs makes this safe if the acknowledgement below fails once.
    if (sent.indexOf(reply.id) === -1) {
      var original = GmailApp.getMessageById(reply.messageId);
      var to = parseFrom_(original.getFrom()).email;
      if (to === reply.to.toLowerCase()) {
        original.reply(reply.bodyText);
        sent.push(reply.id);
      } else {
        Logger.log("Skipped reply " + reply.id + ": recipient does not match the original sender.");
      }
    }
    done.push(reply.id);
  });

  props.setProperty("SENT_IDS", JSON.stringify(sent.slice(-SENT_MEMORY)));
  call_(cfg, "post", "/api/gmail/outbox/ack", { ids: done });
}

// ---------------------------------------------------------------- plumbing

function config_() {
  var p = PropertiesService.getScriptProperties();
  var cfg = {
    appUrl: clean_(p.getProperty("APP_URL")),
    secret: clean_(p.getProperty("BRIDGE_SECRET")),
    bypass: clean_(p.getProperty("VERCEL_BYPASS")),
    query: clean_(p.getProperty("QUERY")) || DEFAULT_QUERY,
  };
  if (!cfg.appUrl || !cfg.secret) {
    throw new Error("Set APP_URL and BRIDGE_SECRET under Project Settings -> Script properties.");
  }
  cfg.appUrl = cfg.appUrl.replace(/\/+$/, "");
  return cfg;
}

/** Pasted values often carry an invisible trailing space or newline. */
function clean_(value) {
  return value ? String(value).trim() : value;
}

function call_(cfg, method, path, body) {
  var headers = { "x-bridge-secret": cfg.secret };
  if (cfg.bypass) headers["x-vercel-protection-bypass"] = cfg.bypass;
  var options = { method: method, headers: headers, muteHttpExceptions: true };
  if (body) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(body);
  }
  var res = UrlFetchApp.fetch(cfg.appUrl + path, options);
  var code = res.getResponseCode();
  if (code >= 300) {
    throw new Error(method.toUpperCase() + " " + path + " failed with HTTP " + code + ": " + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

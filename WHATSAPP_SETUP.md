# WhatsApp Setup Guide (Meta WhatsApp Cloud API)

This guide walks through creating and configuring the official Meta WhatsApp
Cloud API so ClawBot can send you approval cards / notifications on WhatsApp
and receive control commands back (`/range`, `/Auto`, `/Manual`, `/approve`,
etc. — see `src/whatsapp/handlers.js` for the full command list).

This is the **official** Meta API (same family as the Instagram Graph API
ClawBot already uses for cold-DM webhooks), not a third-party/unofficial
WhatsApp automation tool.

---

## 1. Create (or reuse) a Meta App

1. Go to https://developers.facebook.com/apps and log in with the Facebook
   account that manages your Meta Business account.
2. If you already created an app for the Instagram Graph API integration,
   you can reuse it — skip to step 3.
3. Otherwise click **Create App** → choose type **Business** → give it a
   name (e.g. `ClawBot`) → **Create App**.

## 2. Add the WhatsApp Product

1. In the app dashboard, find **WhatsApp** in the product list and click
   **Set up**.
2. If prompted, connect or create a **Meta Business Account** (Business
   Manager). This is required — WhatsApp Cloud API is tied to a Business
   Account, not a personal profile.
3. You'll land on **WhatsApp → API Setup**. Meta automatically provisions a
   **free test phone number** you can use immediately for development.

## 3. Get Your Credentials

On the **WhatsApp → API Setup** page you'll see:

- **Temporary access token** — valid ~24 hours, fine for quick testing but
  will expire. For production you need a **permanent token** (step 4).
- **Phone number ID** — a long numeric ID (NOT the phone number itself).
  This is what goes in `WHATSAPP_CLOUD_PHONE_NUMBER_ID`.
- **A test recipient list** — while using the free test number, you must
  add your own WhatsApp number here and verify it with an OTP before Meta
  will deliver messages to it.

## 4. Generate a Permanent Access Token (for production)

The temporary token expires — do this before going live:

1. Go to **Business Settings** (business.facebook.com/settings) →
   **Users → System Users**.
2. Click **Add** → create a system user (e.g. `clawbot-system-user`) with
   role **Admin**.
3. Click **Add Assets** → select your app under **Apps** → give it
   **Full Control**.
4. Click **Generate New Token** on the system user → select your app →
   check the `whatsapp_business_messaging` and `whatsapp_business_management`
   permissions → **Generate Token**.
5. Copy this token immediately (shown only once) → this is your
   `WHATSAPP_CLOUD_TOKEN`. It does not expire (unless revoked).

## 5. Move to a Real Business Phone Number (optional but recommended)

The free test number only works with numbers you've manually verified and
resets periodically. For a stable production setup:

1. **WhatsApp → API Setup → Add phone number**.
2. Enter a phone number you own that is **not already registered on
   WhatsApp** (personal or business app) — Meta will send a verification
   code via SMS/voice call.
3. Complete **Business Verification** if prompted (may require business
   documents — this can take 1–3 days for Meta review).
4. Once verified, this number's **Phone Number ID** replaces the test one
   in `WHATSAPP_CLOUD_PHONE_NUMBER_ID`.

## 6. Configure the Webhook (so WhatsApp → ClawBot works)

This is what lets you send commands *from* WhatsApp back to the bot.

1. In your app, go to **WhatsApp → Configuration**.
2. Under **Webhook**, click **Edit**.
3. **Callback URL**: `https://<your-deployed-domain>/api/webhooks/whatsapp`
   (must be publicly reachable over HTTPS — e.g. your Railway/Render URL).
4. **Verify token**: any string you choose — it must exactly match the
   `WHATSAPP_VERIFY_TOKEN` env var (see step 7). Meta will call the
   callback URL with this token to confirm you control the endpoint.
5. Click **Verify and Save**. If it fails, make sure the app is deployed
   and `WHATSAPP_VERIFY_TOKEN` is already set in your live environment
   *before* clicking verify.
6. Under **Webhook fields**, click **Manage** and subscribe to the
   **messages** field. This is required — without it, Meta will never
   forward incoming messages/button taps to your webhook.

## 7. Set Environment Variables

Add these to your `.env` (local) and your host's env vars (Railway,
Render, etc. for production):

```bash
WHATSAPP_CLOUD_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxx      # permanent token from step 4
WHATSAPP_CLOUD_PHONE_NUMBER_ID=1234567890123456       # from step 3 or 5
WHATSAPP_VERIFY_TOKEN=some_secret_string_you_pick      # must match step 6
WHATSAPP_CONTROL_NUMBERS=919905251524                  # comma-separated wa_ids allowed to control the bot
```

`WHATSAPP_CONTROL_NUMBERS` uses E.164 format **without** the leading `+`
(e.g. `919905251524` for `+91 99052 51524`). This is the phone that sends
commands to the bot and receives approval cards — add multiple numbers
comma-separated if more than one person should have control.

## 8. Test It

1. Restart/redeploy ClawBot so it picks up the new env vars.
2. From `WHATSAPP_CONTROL_NUMBERS`' phone, send `hi` or `/help` to the
   WhatsApp number shown in **API Setup** (or the number from step 5).
   - If using the free test number, this number must be in the test
     recipient list (step 3) and OTP-verified first.
3. You should get the command reference back. Try `/status @someusername`
   or `/list` to confirm read access works.
4. Trigger a discovery scan (`/discover`) and confirm the approval card
   with ✅/❌ buttons arrives and taps route back correctly (check server
   logs for `[WhatsApp Webhook]` lines).

## Troubleshooting

- **Webhook verification fails**: the callback URL must already be live
  and reachable, and `WHATSAPP_VERIFY_TOKEN` in your deployed env must
  match exactly what you typed in the Meta dashboard.
- **Messages not arriving at your phone**: confirm you subscribed to the
  `messages` webhook field (step 6), and — if still on the test number —
  that your phone is in the verified test recipient list.
- **"This message could not be sent" / permission errors from the API**:
  the system user token needs `whatsapp_business_messaging` permission
  and Full Control access to the app (step 4).
- **Token stopped working after ~24h**: you're still using the temporary
  token from API Setup — swap to the permanent system-user token
  (step 4).
- **Commands ignored / no reply at all**: the sender's number must be
  listed in `WHATSAPP_CONTROL_NUMBERS` (or the DB-persisted equivalent —
  use `/AddNumber <wa_id>` from an already-authorized number to add more).

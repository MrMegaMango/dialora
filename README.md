# Call Driver

Call Driver is a local-first phone conversation agent for macOS. You give it an
intention, facts it may use, boundaries, and a definition of success. It then
listens to each turn, decides what to say, and speaks through the Kokoro container.

The current version uses:

- the macOS Phone app and your paired iPhone for the cellular connection;
- local MLX Whisper for speech recognition;
- local Qwen through MLX for conversation decisions;
- the existing Kokoro service at `http://127.0.0.1:8880` for speech.

No raw call audio is retained. Text transcripts are saved under `data/sessions/`
on this Mac and are ignored by Git.

## Public demo

The Vercel deployment is deliberately a client-only typed rehearsal. It uses
the browser's built-in voice, sends no brief or phone number to a server, and
cannot place calls. Live calling remains local because Apple MLX and the Kokoro
container run only on the Mac.

## Set up

The first setup downloads the local Qwen model (about 3 GB). Whisper is reused
from the existing Hugging Face cache when it is already present.

```sh
cd /Users/zwang/Code/personal/call-driver
make setup
make run
```

Then open [http://127.0.0.1:4310](http://127.0.0.1:4310). After setup, you can
also double-click `run.command` in Finder.

## Use it

1. Describe the desired outcome, permitted facts, hard boundaries, and what
   counts as success.
2. Rehearse with typed replies first.
3. For a real call, click **Open in Phone**. The Phone app asks you to place the
   call through your paired iPhone.
4. Put the iPhone on speakerphone beside the Mac. Once the person answers,
   return to Call Driver and click **Start AI after they answer**.
5. Watch the transcript. **Take over** immediately mutes the agent; **Resume AI**
   gives the next turn back to it.
6. Hang up in the Phone app when Call Driver reports completion.

macOS does not provide a supported API for a third-party app to inject audio
directly into a native cellular call. This MVP therefore uses the Mac microphone
and speakers as an acoustic bridge. A production version should use a SIP or
telephony provider for a direct, echo-free audio connection.

## Safety defaults

Every session starts by identifying the caller as an AI assistant, naming the
person it represents, disclosing live transcription, and asking permission to
continue. The conversation prompt also requires immediate compliance with stop
or do-not-call requests and hands the call to a human for credentials, payments,
binding commitments, or other high-impact decisions.

Use Call Driver only for legitimate calls to people and organizations you are
allowed to contact. It is not suitable for emergency, medical, legal, collections,
political, bulk, or unsolicited sales calls. Call recording and automated-calling
laws vary by location; the operator remains responsible for local requirements.

## Optional OpenAI brain

The local model is the default. To use the OpenAI Responses API instead, create
`.env.local` without committing it:

```dotenv
BRAIN_PROVIDER=openai
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-5.4-mini
```

The key is read only by the localhost server and is never sent to the browser.

## Verify

```sh
make test
```

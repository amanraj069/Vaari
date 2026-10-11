/**
 * Voice notes on WhatsApp: Transcribe's words go through the same agent turn as typed text, the
 * farmer reads what was heard, and Polly speaks exactly what the turn sent (never links, never the
 * "I heard" line). A change or booking still needs a Confirm tap. Any failure falls back to text.
 * Transcribe and Polly are stand-ins here (FakeSpeech); no AWS call is made.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_FARMER_PHONE } from "../src/demo/seed";
import type { AgentRunner } from "../src/whatsapp/agent";
import { words } from "../src/whatsapp/messages";
import { toDevanagari } from "../src/whatsapp/language";
import { FakeSpeech, ScriptedRunner, messageBody, whatsappRuntime } from "./whatsapp-helpers";

const JASWINDER = "447700900017";
const UNKNOWN = "447700900555";
const NOTE = { bytes: new TextEncoder().encode("OggS-voice-note"), mimeType: "audio/ogg; codecs=opus" };
const GURMUKHI = /[਀-੿]/;
type Runtime = Awaited<ReturnType<typeof whatsappRuntime>>;

/** One runtime, the model swapped per test. */
class SwitchableRunner implements AgentRunner {
  current: AgentRunner = new ScriptedRunner(async () => "");
  run(input: Parameters<AgentRunner["run"]>[0]) {
    return this.current.run(input);
  }
}

async function voiceRuntime(config: Record<string, unknown> = {}) {
  const runner = new SwitchableRunner();
  const speech = new FakeSpeech();
  const runtime = await whatsappRuntime({ config: { AGENT_ENABLED: true, VOICE_ENABLED: true, VOICE_MAX_BYTES: 64, ...config }, runner, speech });
  runtime.sender.media.set("media-1", NOTE);
  return { runtime, runner, speech };
}

let runtime: Runtime;
let runner: SwitchableRunner;
let speech: FakeSpeech;
const sentSince = (count: number) => runtime.sender.sent.slice(count).filter((message) => message.to === DEMO_FARMER_PHONE);

beforeAll(async () => {
  ({ runtime, runner, speech } = await voiceRuntime());
});

/** A voice note from Jaswinder; returns everything sent to them for it. */
async function sendNote(from = JASWINDER) {
  const before = runtime.sender.sent.length;
  const spokenBefore = speech.spoken.length;
  await runtime.deliver(messageBody({ from, audio: true }));
  return { sent: sentSince(before), spoken: speech.spoken.slice(spokenBefore) };
}

describe("a voice note goes through the agent and comes back as text and a voice note", () => {
  it("Hindi: shows what was heard, answers from the tools, then speaks that answer in Hindi", async () => {
    speech.heard = { text: "मेरी मशीन कब आएगी?", locale: "hi" };
    let modelInput = "";
    runner.current = { run: async (input) => ((modelInput = input.text), new ScriptedRunner(async (tool) => (await tool("get_slot").run({ fieldRef: 1 }), "")).run(input)) };
    const { sent, spoken } = await sendNote();

    expect(speech.notes.at(-1)).toEqual(NOTE.bytes);
    expect(modelInput).toBe("मेरी मशीन कब आएगी?");
    expect(sent[0]).toMatchObject({ type: "text", body: words("hi").heard("मेरी मशीन कब आएगी?") });
    const answer = sent[1];
    expect(answer?.type).toBe("text");
    expect(sent.at(-1)).toMatchObject({ type: "voice" });
    // Polly said exactly the answer the farmer can read, in Hindi, and not the "I heard" line.
    expect(spoken).toHaveLength(1);
    expect(spoken[0]!.language).toBe("hi-IN");
    expect(answer?.type === "text" && spoken[0]!.text).toBe(answer?.type === "text" && answer.body.trim());
    expect(spoken[0]!.text).not.toContain("मैंने सुना");
    // The voice note sent is the audio Polly made, uploaded as OGG.
    const voice = sent.at(-1);
    expect(voice?.type === "voice" && runtime.sender.uploaded.get(voice.mediaId)).toEqual({ bytes: new TextEncoder().encode("OggS:hi-IN"), mimeType: "audio/ogg" });
  });

  it("Punjabi: the text stays in Gurmukhi, and the Hindi voice reads the same words in Devanagari", async () => {
    speech.heard = { text: "ਮੇਰੀ ਮਸ਼ੀਨ ਕਦੋਂ ਆਵੇਗੀ?", locale: "pa" };
    runner.current = new ScriptedRunner(async (tool) => (await tool("get_slot").run({ fieldRef: 1 }), ""));
    const { sent, spoken } = await sendNote();

    expect(sent[0]).toMatchObject({ type: "text", body: words("pa").heard("ਮੇਰੀ ਮਸ਼ੀਨ ਕਦੋਂ ਆਵੇਗੀ?") });
    const answer = sent[1];
    expect(answer?.type === "text" && GURMUKHI.test(answer.body)).toBe(true);
    expect(spoken[0]!.language).toBe("hi-IN");
    expect(GURMUKHI.test(spoken[0]!.text)).toBe(false);
    expect(answer?.type === "text" && spoken[0]!.text).toBe(answer?.type === "text" && toDevanagari(answer.body.trim()));
    expect(sent.at(-1)).toMatchObject({ type: "voice" });
  });

  it("English: spoken with the Indian English voice", async () => {
    speech.heard = { text: "When will my machine come?", locale: "en" };
    runner.current = new ScriptedRunner(async (tool) => (await tool("get_slot").run({ fieldRef: 1 }), ""));
    const { spoken } = await sendNote();
    expect(spoken[0]!.language).toBe("en-IN");
  });

  it("a booking by voice is only drafted: Confirm buttons are sent and spoken, nothing is booked", async () => {
    speech.heard = { text: "Book Balian, 4 acres, I can wait till 3 November", locale: "en" };
    runner.current = new ScriptedRunner(async (tool) => (await tool("book_field").run({ village: "Balian", acres: 4, lastDayYouCanWait: { day: 3, month: 11 } }), "It is booked."));
    const fieldsBefore = (await runtime.runtime.dependencies.store.listFieldsByPhone(DEMO_FARMER_PHONE)).length;
    const { sent, spoken } = await sendNote();

    const confirm = sent.find((message) => message.type === "buttons");
    expect(confirm?.type === "buttons" && confirm.buttons.map((button) => button.title)).toEqual([words("en").confirm, words("en").cancel]);
    // The model's "It is booked." is never sent or said; our own Confirm message is.
    expect(JSON.stringify(sent)).not.toContain("It is booked.");
    expect(confirm?.type === "buttons" && spoken[0]!.text).toContain(confirm?.type === "buttons" && confirm.body.split("\n")[0]);
    expect((await runtime.runtime.dependencies.store.listFieldsByPhone(DEMO_FARMER_PHONE)).length).toBe(fieldsBefore);
  });

  it("links are sent as text but never spoken", async () => {
    speech.heard = { text: "Send me my page", locale: "en" };
    runner.current = new ScriptedRunner(async (tool) => (await tool("send_my_fields_page").run({}), ""));
    const { sent, spoken } = await sendNote();
    expect(JSON.stringify(sent)).toMatch(/https?:\/\//);
    expect(spoken.map((item) => item.text).join(" ")).not.toMatch(/https?:|\/farmer\/login/);
  });
});

describe("booking by voice", () => {
  it("'मुझे खेत बुक करना है' said, no details: Vaari asks for them with its own words, read and heard, in Hindi", async () => {
    speech.heard = { text: "मुझे खेत बुक करना है ।", locale: "hi" };
    // The model asks with an example of its own; the number check would refuse it, and code answers instead.
    runner.current = new ScriptedRunner(async (tool) => (await tool("book_field").run({}), "जैसे: 4 एकड़, 3 नवंबर तक।"));
    const { sent, spoken } = await sendNote();
    expect(sent.map((message) => message.type)).toEqual(["text", "text", "voice"]);
    expect(sent[0]).toMatchObject({ body: words("hi").heard("मुझे खेत बुक करना है ।") });
    expect(sent[1]).toMatchObject({ body: words("hi").bookAsk });
    expect(spoken.map((item) => item.text)).toEqual([words("hi").bookAsk]);
  });
});

describe("a voice note is part of the conversation", () => {
  it("the next message's model sees what was heard and the answer, never the 'I heard' line", async () => {
    speech.heard = { text: "मुझे मशीन चाहिए", locale: "hi" };
    const question = "आपका खेत किस गाँव में है?";
    runner.current = new ScriptedRunner(async () => question);
    const { sent, spoken } = await sendNote();
    expect(sent.map((message) => message.type)).toEqual(["text", "text", "voice"]);
    expect(sent[1]).toMatchObject({ type: "text", body: question });
    expect(spoken.map((item) => item.text)).toEqual([question]);

    let history: Parameters<AgentRunner["run"]>[0]["history"] = [];
    runner.current = { run: async (input) => ((history = input.history), "") };
    // A message with no letters keeps the farmer's remembered language (Punjabi, which later tests expect).
    await runtime.deliver(messageBody({ from: JASWINDER, text: "4" }));
    expect(history.at(-1)).toEqual({ farmer: "मुझे मशीन चाहिए", vaari: question });
  });
});

describe("failures fall back to text", () => {
  it("nothing heard: the menu with 'say it again', and the model is never called", async () => {
    speech.heard = null;
    let modelCalls = 0;
    runner.current = { run: async () => ((modelCalls += 1), "") };
    const { sent, spoken } = await sendNote();
    expect(modelCalls).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "list" });
    expect(sent[0]?.type === "list" && sent[0].body).toContain(words("pa").voiceNotUnderstood);
    expect(spoken).toHaveLength(0);
  });

  it("Transcribe fails: the same, nothing spoken", async () => {
    speech.failTranscribe = true;
    try {
      const { sent, spoken } = await sendNote();
      expect(sent[0]?.type === "list" && sent[0].body).toContain(words("pa").voiceNotUnderstood);
      expect(spoken).toHaveLength(0);
    } finally {
      speech.failTranscribe = false;
    }
  });

  it("a note over VOICE_MAX_BYTES is not downloaded or transcribed", async () => {
    runtime.sender.media.set("media-1", { bytes: new Uint8Array(65), mimeType: NOTE.mimeType });
    const notesBefore = speech.notes.length;
    try {
      const { sent } = await sendNote();
      expect(speech.notes.length).toBe(notesBefore);
      expect(sent[0]?.type === "list" && sent[0].body).toContain(words("pa").voiceNotUnderstood);
    } finally {
      runtime.sender.media.set("media-1", NOTE);
    }
  });

  it("Polly fails: the farmer still gets the heard line and the text answer, no voice note", async () => {
    speech.heard = { text: "When will my machine come?", locale: "en" };
    speech.failSpeak = true;
    runner.current = new ScriptedRunner(async (tool) => (await tool("get_slot").run({ fieldRef: 1 }), ""));
    try {
      const { sent } = await sendNote();
      expect(sent.map((message) => message.type)).toEqual(["text", "text"]);
    } finally {
      speech.failSpeak = false;
    }
  });

  it("an unknown number's voice note is never transcribed: the registration reply only", async () => {
    const notesBefore = speech.notes.length;
    const before = runtime.sender.sent.length;
    await runtime.deliver(messageBody({ from: UNKNOWN, audio: true }));
    expect(speech.notes.length).toBe(notesBefore);
    const sent = runtime.sender.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.type === "text" && sent[0].body).toMatch(/\/farmer\/signin/);
  });
});

describe("settings", () => {
  it("VOICE_PUNJABI_AUDIO=false: Punjabi gets text only", async () => {
    const other = await voiceRuntime({ VOICE_PUNJABI_AUDIO: false });
    other.speech.heard = { text: "ਮੇਰੀ ਮਸ਼ੀਨ ਕਦੋਂ ਆਵੇਗੀ?", locale: "pa" };
    other.runner.current = new ScriptedRunner(async (tool) => (await tool("get_slot").run({ fieldRef: 1 }), ""));
    await other.runtime.deliver(messageBody({ from: JASWINDER, audio: true }));
    expect(other.speech.spoken).toHaveLength(0);
    expect(other.runtime.sender.sent.some((message) => message.type === "voice")).toBe(false);
  });

  it("the agent off: a voice note gets 'please type', nothing is transcribed", async () => {
    const other = await voiceRuntime({ AGENT_ENABLED: false });
    await other.runtime.deliver(messageBody({ from: JASWINDER, audio: true }));
    expect(other.speech.notes).toHaveLength(0);
    expect(other.runtime.sender.sent.at(-1)).toMatchObject({ type: "list", body: `${words("pa").voiceNotSupported}\n\n${words("pa").menuBody}` });
  });
});

describe("toDevanagari: Punjabi words in letters the Hindi voice reads", () => {
  it.each([
    ["ਸਤ ਸ੍ਰੀ ਅਕਾਲ", "सत स्री अकाल"],
    ["ਪੱਕਾ", "पक्का"],
    ["ਮੰਗਲਵਾਰ", "मंगलवार"],
    ["੧੨ ਨਵੰਬਰ", "१२ नवंबर"],
    ["ਖ਼ਾਲਸਾ", "ख़ालसा"],
    ["Balian 4, #007", "Balian 4, #007"],
  ])("%s -> %s", (gurmukhi, devanagari) => {
    expect(toDevanagari(gurmukhi)).toBe(devanagari);
  });
});

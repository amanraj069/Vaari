/**
 * Voice notes. Amazon Transcribe hears a farmer's note and names its language; Amazon Polly reads
 * Vaari's reply aloud. Neither decides anything: the heard words go through the same agent turn as
 * typed text (same tools, same number check), and Polly reads only text that turn already sent.
 *
 * Why a batch job and not streaming: Transcribe's streaming language detection takes PCM or FLAC
 * only, and WhatsApp notes are OGG/Opus; batch takes OGG as it is, with no ffmpeg. Batch reads media
 * only from S3, so each note is put there for its job, and the note and the job (with its
 * transcript) are deleted as soon as the job ends. A lifecycle rule on the prefix catches leftovers.
 *
 * Polly has no Punjabi voice. Its Hindi voice reads Devanagari, and Gurmukhi maps onto Devanagari
 * letter for letter, so a Punjabi reply is written in Devanagari (toDevanagari, language.ts) and read by the Hindi
 * voice: Punjabi words in a Hindi accent. A Punjabi speaker must listen before the demo.
 */
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DeleteTranscriptionJobCommand, GetTranscriptionJobCommand, StartTranscriptionJobCommand, TranscribeClient } from "@aws-sdk/client-transcribe";
import { PollyClient, SynthesizeSpeechCommand, type VoiceId } from "@aws-sdk/client-polly";
import type { Config } from "../config";
import { logger } from "../logger";
import type { Locale } from "../shared";

/** What Transcribe heard, and in which of our languages. */
export type Heard = { text: string; locale: Locale };

export interface SpeechService {
  /** The words in a voice note (OGG/Opus), or null when nothing was heard. `name` makes the job unique. */
  transcribe(audio: Uint8Array, name: string): Promise<Heard | null>;
  /** Speech for `text` as OGG/Opus, mono, 48 kHz: what WhatsApp plays as a voice note. */
  speak(text: string, language: "hi-IN" | "en-IN"): Promise<Uint8Array>;
}

/** The languages Transcribe chooses between, and our locale for each. */
const HEARD_LOCALES: Record<string, Locale> = { "pa-IN": "pa", "hi-IN": "hi", "en-IN": "en" };

export class AwsSpeech implements SpeechService {
  private readonly s3: S3Client;
  private readonly transcriber: TranscribeClient;
  private readonly polly: PollyClient;

  constructor(private readonly config: Config) {
    const region = config.AWS_REGION ?? "ap-south-1";
    this.s3 = new S3Client({ region });
    this.transcriber = new TranscribeClient({ region });
    this.polly = new PollyClient({ region });
  }

  async transcribe(audio: Uint8Array, name: string): Promise<Heard | null> {
    // Job names allow letters, digits, ".", "_" and "-"; WhatsApp message ids carry "=" and "+".
    const jobName = `vaari-${name.replace(/[^0-9A-Za-z._-]/g, "-").slice(-120)}-${Date.now()}`;
    const bucket = this.config.VOICE_S3_BUCKET;
    const key = `${this.config.VOICE_S3_PREFIX}${jobName}.ogg`;
    const started = Date.now();
    await this.s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: audio, ContentType: "audio/ogg" }));
    try {
      await this.transcriber.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: jobName,
          Media: { MediaFileUri: `s3://${bucket}/${key}` },
          MediaFormat: "ogg",
          IdentifyLanguage: true,
          LanguageOptions: ["pa-IN", "hi-IN", "en-IN"],
        }),
      );
      const deadline = started + this.config.VOICE_TRANSCRIBE_TIMEOUT_SECONDS * 1000;
      for (;;) {
        const job = (await this.transcriber.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }))).TranscriptionJob;
        if (job?.TranscriptionJobStatus === "COMPLETED") {
          // No output bucket: the transcript sits in Transcribe's own storage behind a signed URL.
          const response = await fetch(job.Transcript?.TranscriptFileUri ?? "", { signal: AbortSignal.timeout(10_000) });
          const result = (await response.json()) as { results?: { transcripts?: { transcript?: string }[] } };
          const text = (result.results?.transcripts ?? []).map((part) => part.transcript ?? "").join(" ").trim();
          const locale = HEARD_LOCALES[job.LanguageCode ?? ""];
          // Timing and language only: never the farmer's words.
          logger.info({ language: job.LanguageCode, ms: Date.now() - started, characters: text.length }, "transcribe: voice note heard");
          return text && locale ? { text, locale } : null;
        }
        if (job?.TranscriptionJobStatus === "FAILED") throw new Error(`Transcribe job failed: ${job.FailureReason ?? "no reason given"}`);
        if (Date.now() > deadline) throw new Error(`Transcribe job not done after ${this.config.VOICE_TRANSCRIBE_TIMEOUT_SECONDS} s`);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    } finally {
      // The farmer's voice is kept no longer than the job: the note and the transcript both go.
      const cleanup = await Promise.allSettled([
        this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
        this.transcriber.send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName })),
      ]);
      for (const outcome of cleanup) {
        if (outcome.status === "rejected") logger.warn({ err: outcome.reason instanceof Error ? `${outcome.reason.name}: ${outcome.reason.message}` : "unknown" }, "transcribe: cleanup failed (the S3 lifecycle rule removes the note)");
      }
    }
  }

  async speak(text: string, language: "hi-IN" | "en-IN"): Promise<Uint8Array> {
    const result = await this.polly.send(
      new SynthesizeSpeechCommand({
        Text: text,
        VoiceId: this.config.VOICE_POLLY_VOICE as VoiceId,
        Engine: this.config.VOICE_POLLY_ENGINE,
        LanguageCode: language,
        OutputFormat: "ogg_opus",
        SampleRate: "48000",
      }),
    );
    if (!result.AudioStream) throw new Error("Polly returned no audio");
    return result.AudioStream.transformToByteArray();
  }
}

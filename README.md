# FlowSpeech MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that brings [FlowSpeech](https://flowspeech.io) text-to-speech capabilities directly into your LLM workflows.

## What is FlowSpeech?

[FlowSpeech](https://flowspeech.io) is a context-aware text-to-speech tool that converts text into human-like audio with:

- 🎭 **Emotion control** — stage directions like `***(say cheerfully: Hello!)***`
- ⏸️ **Pause control** — natural pacing and rhythm
- 🎙️ **30+ voices** — male and female voices across moods and styles
- 🌊 **Human-like output** — natural-sounding synthesis for creators, educators, and developers

## Installation

Run the MCP server directly with npx (no install needed):

```bash
npx mcp-flowspeech-server
```

Or install globally:

```bash
npm install -g mcp-flowspeech-server
```

## Configuration

Add to your MCP client config (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "flowspeech": {
      "command": "npx",
      "args": ["-y", "mcp-flowspeech-server"],
      "env": {
        "FLOWSPEECH_OUTPUT_DIR": "~/flowspeech-audio"
      }
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `FLOWSPEECH_OUTPUT_DIR` | Directory to save generated audio files | `~/.flowspeech-mcp/audio` |

## Tools

### `flowspeech_tts`

Convert text to speech with a single voice.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `text` | string | ✅ | Text to synthesize. Supports emotion stage directions. |
| `voice` | string | | Voice name (default: `Kore`) |
| `output_path` | string | | Custom file path for the output audio |

**Example:**

```
Convert this to audio with a cheerful tone using the Puck voice:
"***(say cheerfully: Good morning, everyone!)*** Today we're going to explore something amazing."
```

### `flowspeech_tts_multi`

Convert a two-speaker dialogue to speech.

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `text` | string | ✅ | Dialogue with `Speaker1:` and `Speaker2:` prefixes |
| `voice_a` | string | | Voice for Speaker1 (default: `Charon`) |
| `voice_b` | string | | Voice for Speaker2 (default: `Kore`) |
| `output_path` | string | | Custom file path for the output audio |

**Example:**

```
Speaker1: Welcome to the show! I'm your host.
Speaker2: And I'm your co-host. Great to be here!
Speaker1: Today we're talking about AI voices.
```

### `flowspeech_list_voices`

List all available voices.

**Parameters:**

| Name | Type | Description |
|---|---|---|
| `gender` | `male` \| `female` \| `all` | Filter by gender (default: `all`) |

## Available Voices

| Voice | Gender | Style |
|---|---|---|
| Puck | Male | Upbeat and playful |
| Fenrir | Male | Excitable and energetic |
| Zephyr | Female | Bright and cheerful |
| Autonoe | Female | Bright and welcoming |
| Charon | Male | Informative and narrative |
| Kore | Female | Firm and focused |
| Orus | Male | Firm and decisive |
| Iapetus | Male | Clear and professional |
| Umbriel | Male | Easy-going and relaxed |
| Callirrhoe | Female | Easy-going and soothing |
| Sulafat | Female | Warm and inviting |
| Achernar | Female | Soft and tender |
| Gacrux | Female | Mature and experienced |
| … | … | 30+ total — use `flowspeech_list_voices` to see all |

## Emotion Stage Directions

FlowSpeech supports inline emotion control using the format `***(say <style>: text)***`:

```
***(say cheerfully: Good morning!)*** 
Today I want to talk about something important.
***(say solemnly: This affects all of us.)***
```

## Links

- 🌐 Website: [https://flowspeech.io](https://flowspeech.io)
- 🎬 Demo: [https://youtu.be/nkBI7WbggW8](https://youtu.be/nkBI7WbggW8)
- 📦 npm: [https://www.npmjs.com/package/mcp-flowspeech-server](https://www.npmjs.com/package/mcp-flowspeech-server)

## License

MIT

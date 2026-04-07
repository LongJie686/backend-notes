# LLM (Large Language Model)

## Architecture Overview

- Transformer: Self-Attention + Feed-Forward
- Decoder-only: GPT series
- Encoder-Decoder: T5, BART

## Key Concepts

### Tokenization

- BPE (Byte Pair Encoding): GPT uses this
- SentencePiece: Language-agnostic
- Roughly: 1 token ~ 4 chars (English) or ~ 1.5 chars (Chinese)

### Context Window

| Model | Context Length |
|-------|---------------|
| GPT-4o | 128K |
| Claude 3.5 Sonnet | 200K |
| Gemini 1.5 Pro | 1M |

### Temperature

- 0: Deterministic output
- 0.7: Balanced creativity
- 1.0+: More random / creative

## Prompt Engineering

### Core Patterns

1. **Zero-shot**: Direct instruction
2. **Few-shot**: Provide examples
3. **Chain-of-Thought**: Step-by-step reasoning
4. **ReAct**: Reason + Act loop

### Example: Few-shot Classification

```
Classify the sentiment:

Text: "This product is amazing!" -> Positive
Text: "Terrible experience" -> Negative
Text: "It's okay, nothing special" -> Neutral
Text: "{user_input}" ->
```

## RAG (Retrieval-Augmented Generation)

```
User Query
    -> Embedding
    -> Vector DB Search
    -> Context + Query
    -> LLM
    -> Response
```

### Key Components

1. Document chunking strategy
2. Embedding model selection
3. Vector database (Milvus / Pinecone / Chroma)
4. Reranking
5. Prompt template design

## Agent

### Core Loop

```
while not done:
    1. Observe: Read environment/tool output
    2. Think: LLM reasoning
    3. Act: Call tool / respond
```

### Tool Use

```python
tools = [
    {"name": "search", "description": "Search the web"},
    {"name": "calculator", "description": "Do math"},
]

# LLM decides which tool to call with what arguments
```

## Fine-tuning vs RAG vs Prompt

| Approach | Cost | Latency | Knowledge Update |
|----------|------|---------|-----------------|
| Prompt Engineering | Low | Fast | Real-time |
| RAG | Medium | Medium | Real-time (update DB) |
| Fine-tuning | High | Fast | Retrain needed |

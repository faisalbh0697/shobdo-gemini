# Shobdo

অডিও আপলোড করলেই OpenAI Whisper দিয়ে শব্দে শব্দে ট্রান্সক্রিপশন। প্রতিটা শব্দের শুরু ও শেষ সময় থাকে। শব্দে ক্লিক করলে অডিও সেই জায়গা থেকে বাজে।

## চালানো

```bash
npm install
npm run dev
```

ব্রাউজারে খুলে OpenAI API key দিন (`sk-...`)। key শুধু এই ব্রাউজারের localStorage-এ থাকে। সার্ভারে সেভ হয় না — ট্রান্সক্রাইব চাপলে আপনার সার্ভার key-টা OpenAI-তে ফরওয়ার্ড করে।

## সীমা

- মডেল: `whisper-1` (word-level timestamp)
- ফাইল সর্বোচ্চ ২৫ MB
- ফরম্যাট: mp3, wav, m4a, mp4, mpeg, webm, ogg, flac

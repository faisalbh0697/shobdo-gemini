# Shobdo

অডিও আপলোড করলেই Google **Gemini 3.5 Transcribe** দিয়ে ট্রান্সক্রিপশন। শব্দে ক্লিক করলে অডিও সেই জায়গা থেকে বাজে।

ব্রাউজার সরাসরি Gemini-তে অডিও পাঠায় — তাই **Vercel**-এ বড় ফাইলও কাজ করে (Vercel body-limit এড়ায়)।

## চালানো (লোকাল)

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) এ [Google AI Studio](https://aistudio.google.com/apikey) key দিন (`AIza...`)। key শুধু localStorage-এ থাকে।

## Vercel-এ ডিপ্লয়

1. এই রিপো Vercel-এ Import করুন  
2. Framework: Next.js (অটো)  
3. Env ভ্যারিয়েবল লাগে না — ইউজার নিজের Gemini key UI-তে দেয়  
4. Deploy

অথবা CLI:

```bash
npx vercel
```

## মডেল

| মডেল | ব্যবহার |
|------|----------|
| `gemini-3.5-transcribe` | ফাইল ট্রান্সক্রিপশন + word timestamps |

## সীমা

- ফরম্যাট: mp3, wav, m4a, mp4, mpeg, webm, ogg, flac
- Word timestamps সহ ~২৫ মিনিট / চাঙ্ক; লম্বা ফাইল চাঙ্ক হয়
- বাংলা: `bn-BD`
- খরচ এস্টিমেট UI-তে দেখায় (≈১৩০৳/$)

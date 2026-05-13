# PDF Stamp Studio

A standalone Vite + TypeScript app for browser-only PDF form filling and approval stamping.

## What it does

- Accepts drag-and-drop PDF input.
- Detects fillable AcroForm fields in the browser.
- Uses field-name heuristics to prefill shared details like name, company, phone, email, reference, and date.
- Shows a manual field editor for anything the heuristics miss.
- Adds the approval-table stamp layout shown in your example, with optional PNG/JPG image overlay.
- Exports a new PDF locally without uploading the source document.

## Current scope

This first pass is tuned for fillable PDFs with AcroForm fields.
Scanned PDFs without form fields will still preview and stamp, but they will need OCR plus coordinate mapping in a later iteration.

## Run locally

If you do not have Node installed globally, this repo can also use a workspace-local runtime in `.tools`.

```bash
npm install
npm run dev
```

To produce a production build:

```bash
npm run build
```

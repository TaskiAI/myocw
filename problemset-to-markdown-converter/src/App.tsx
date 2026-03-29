/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef } from "react";
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { 
  FileUp, 
  FileText, 
  Download, 
  Loader2, 
  AlertCircle,
  Copy,
  CheckCircle2,
  Trash2,
  Link as LinkIcon,
  Globe
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type InputMethod = "file" | "url";

export default function App() {
  const [inputMethod, setInputMethod] = useState<InputMethod>("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string>("");
  const [markdown, setMarkdown] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === "application/pdf") {
      setFile(selectedFile);
      setError(null);
    } else {
      setError("Please select a valid PDF file.");
      setFile(null);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64String = (reader.result as string).split(",")[1];
        resolve(base64String);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const fetchPdfFromUrl = async (pdfUrl: string): Promise<string> => {
    try {
      const response = await fetch(pdfUrl);
      if (!response.ok) throw new Error(`Failed to fetch PDF: ${response.statusText}`);
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onload = () => {
          const base64String = (reader.result as string).split(",")[1];
          resolve(base64String);
        };
        reader.onerror = (error) => reject(error);
      });
    } catch (err: any) {
      if (err.message.includes('Failed to fetch')) {
        throw new Error("CORS error: The server hosting the PDF does not allow cross-origin requests. Please download the file and upload it manually.");
      }
      throw err;
    }
  };

  const convertToMarkdown = async () => {
    if (inputMethod === "file" && !file) return;
    if (inputMethod === "url" && !url) return;

    setIsProcessing(true);
    setError(null);
    setMarkdown("");

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      let base64Data = "";

      if (inputMethod === "file" && file) {
        base64Data = await fileToBase64(file);
      } else if (inputMethod === "url" && url) {
        base64Data = await fetchPdfFromUrl(url);
      }

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                text: "You are an expert LaTeX and Markdown converter. Convert the provided ProblemSet PDF into a clean Markdown file. Use LaTeX for all mathematical formulas (e.g., $...$ for inline and $$...$$ for block). Ensure all text, diagrams (described in text), and structures are preserved. Output ONLY the markdown content.",
              },
              {
                inlineData: {
                  data: base64Data,
                  mimeType: "application/pdf",
                },
              },
            ],
          },
        ],
      });

      const text = response.text;
      if (text) {
        setMarkdown(text);
      } else {
        throw new Error("No content generated from the model.");
      }
    } catch (err: any) {
      console.error("Conversion error:", err);
      setError(err.message || "An error occurred during conversion.");
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadMarkdown = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const urlBlob = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = urlBlob;
    const fileName = inputMethod === "file" ? file?.name.replace(".pdf", "") : "problemset";
    a.download = `${fileName || "problemset"}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(urlBlob);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setFile(null);
    setUrl("");
    setMarkdown("");
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#1A1A1A] font-sans selection:bg-[#E6E6E6]">
      {/* Header */}
      <header className="border-b border-[#E5E5E5] bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#1A1A1A] rounded flex items-center justify-center">
              <FileText className="text-white w-5 h-5" />
            </div>
            <h1 className="font-semibold text-lg tracking-tight">ProblemSet to MD</h1>
          </div>
          {markdown && (
            <div className="flex items-center gap-2">
              <button
                onClick={copyToClipboard}
                className="p-2 hover:bg-[#F5F5F5] rounded-md transition-colors flex items-center gap-2 text-sm font-medium"
                title="Copy Markdown"
              >
                {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
              </button>
              <button
                onClick={downloadMarkdown}
                className="p-2 hover:bg-[#F5F5F5] rounded-md transition-colors flex items-center gap-2 text-sm font-medium"
                title="Download Markdown"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Download</span>
              </button>
              <button
                onClick={reset}
                className="p-2 hover:bg-red-50 text-red-600 rounded-md transition-colors"
                title="Reset"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        {!markdown ? (
          <div className="max-w-2xl mx-auto space-y-8">
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-light tracking-tight sm:text-5xl">
                Convert Problem Sets to <span className="italic font-serif">Markdown</span>
              </h2>
              <p className="text-[#666666] text-lg max-w-md mx-auto">
                Upload your math-heavy PDFs or provide a hyperlink to get clean, editable Markdown with LaTeX support.
              </p>
            </div>

            {/* Input Method Toggle */}
            <div className="flex p-1 bg-[#F5F5F5] rounded-xl w-fit mx-auto">
              <button
                onClick={() => { setInputMethod("file"); setError(null); }}
                className={cn(
                  "px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                  inputMethod === "file" ? "bg-white shadow-sm text-[#1A1A1A]" : "text-[#666666] hover:text-[#1A1A1A]"
                )}
              >
                <FileUp className="w-4 h-4" />
                File Upload
              </button>
              <button
                onClick={() => { setInputMethod("url"); setError(null); }}
                className={cn(
                  "px-6 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2",
                  inputMethod === "url" ? "bg-white shadow-sm text-[#1A1A1A]" : "text-[#666666] hover:text-[#1A1A1A]"
                )}
              >
                <LinkIcon className="w-4 h-4" />
                Hyperlink
              </button>
            </div>

            <div 
              className={cn(
                "relative border-2 border-dashed rounded-2xl p-12 transition-all duration-300 flex flex-col items-center justify-center gap-4 group",
                (inputMethod === "file" ? file : url) ? "border-[#1A1A1A] bg-[#F9F9F9]" : "border-[#E5E5E5] hover:border-[#CCCCCC] bg-white"
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                if (inputMethod !== "file") return;
                e.preventDefault();
                const droppedFile = e.dataTransfer.files[0];
                if (droppedFile?.type === "application/pdf") {
                  setFile(droppedFile);
                  setError(null);
                }
              }}
            >
              {inputMethod === "file" ? (
                <>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".pdf"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  
                  <div className="w-16 h-16 bg-[#F5F5F5] rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    <FileUp className="w-8 h-8 text-[#1A1A1A]" />
                  </div>

                  <div className="text-center">
                    <p className="font-medium text-lg">
                      {file ? file.name : "Click or drag PDF to upload"}
                    </p>
                    <p className="text-sm text-[#999999] mt-1">
                      {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Support for math, diagrams, and complex layouts"}
                    </p>
                  </div>
                </>
              ) : (
                <div className="w-full space-y-4 flex flex-col items-center">
                  <div className="w-16 h-16 bg-[#F5F5F5] rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    <Globe className="w-8 h-8 text-[#1A1A1A]" />
                  </div>
                  <div className="w-full max-w-md relative">
                    <input
                      type="url"
                      placeholder="https://example.com/problemset.pdf"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-[#E5E5E5] focus:outline-none focus:ring-2 focus:ring-[#1A1A1A] transition-all bg-white"
                    />
                  </div>
                  <p className="text-sm text-[#999999]">Provide a direct link to the PDF file</p>
                </div>
              )}

              {((inputMethod === "file" && file) || (inputMethod === "url" && url)) && !isProcessing && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    convertToMarkdown();
                  }}
                  className="mt-4 px-8 py-3 bg-[#1A1A1A] text-white rounded-full font-medium hover:bg-[#333333] transition-all active:scale-95 flex items-center gap-2"
                >
                  Convert Now
                </button>
              )}

              {isProcessing && (
                <div className="mt-4 flex flex-col items-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-[#1A1A1A]" />
                  <p className="text-sm font-medium animate-pulse">
                    {inputMethod === "url" ? "Fetching and analyzing..." : "Analyzing problem set..."}
                  </p>
                </div>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <p className="text-sm font-medium">{error}</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-8">
              {[
                { title: "Direct Links", desc: "Convert PDFs directly from your database or web URLs." },
                { title: "LaTeX Ready", desc: "All formulas converted to standard LaTeX notation." },
                { title: "Structure Aware", desc: "Preserves lists, tables, and section hierarchies." }
              ].map((feature, i) => (
                <div key={i} className="space-y-2">
                  <h3 className="font-semibold text-sm uppercase tracking-wider text-[#999999]">{feature.title}</h3>
                  <p className="text-sm text-[#666666] leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white border border-[#E5E5E5] rounded-2xl overflow-hidden shadow-sm">
              <div className="border-b border-[#E5E5E5] bg-[#FAFAFA] px-6 py-3 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest text-[#999999]">Preview</span>
                <span className="text-xs font-medium text-[#666666]">
                  {inputMethod === "file" ? file?.name : (url.split('/').pop() || "URL Source")}
                </span>
              </div>
              <div className="p-8 sm:p-12 prose prose-slate max-w-none prose-headings:font-light prose-headings:tracking-tight prose-p:leading-relaxed prose-pre:bg-[#F9F9F9] prose-pre:border prose-pre:border-[#E5E5E5] prose-pre:text-[#1A1A1A]">
                <ReactMarkdown 
                  remarkPlugins={[remarkMath]} 
                  rehypePlugins={[rehypeKatex]}
                >
                  {markdown}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="max-w-5xl mx-auto px-6 py-12 border-t border-[#E5E5E5] mt-12">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-[#999999] text-xs font-medium uppercase tracking-widest">
          <p>© 2026 ProblemSet to MD</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-[#1A1A1A] transition-colors">Privacy</a>
            <a href="#" className="hover:text-[#1A1A1A] transition-colors">Terms</a>
            <a href="#" className="hover:text-[#1A1A1A] transition-colors">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

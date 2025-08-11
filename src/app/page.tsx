// src/app/page.tsx
"use client";

import { useState, useRef, useEffect, FormEvent, ChangeEvent } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, User, Paperclip, XCircle } from "lucide-react";

// Define the structure of a message for the UI
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

// Define the structure for the API call history
interface ApiContent {
    role: "user" | "model";
    parts: { text: string }[];
}

// Add pdfjsLib to the window interface for TypeScript
declare global {
    interface Window {
        pdfjsLib: any;
    }
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hello! I'm a friendly AI assistant. How can I help you today? You can also upload a PDF.",
    },
  ]);
  const [input, setInput] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load pdf.js script from CDN
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
    script.async = true;
    script.onload = () => {
      // Set worker source after the main script has loaded
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    };
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // Function to scroll to the bottom of the chat
  const scrollToBottom = () => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  };
  
  // Scroll to bottom whenever messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === "application/pdf") {
      setFile(selectedFile);
      setError(null);
    } else {
      setError("Please select a valid PDF file.");
      setFile(null);
    }
  };

  const parsePdf = async (pdfFile: File): Promise<string> => {
    if (!window.pdfjsLib) {
        throw new Error("PDF.js library is not loaded yet.");
    }
    const fileReader = new FileReader();
    return new Promise((resolve, reject) => {
        fileReader.onload = async (event) => {
            if (!event.target?.result) {
                return reject(new Error("Failed to read file."));
            }
            const typedArray = new Uint8Array(event.target.result as ArrayBuffer);
            try {
                const pdf = await window.pdfjsLib.getDocument({ data: typedArray }).promise;
                let fullText = "";
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map((item: any) => item.str).join(" ");
                    fullText += pageText + "\n";
                }
                resolve(fullText);
            } catch (err) {
                reject(err);
            }
        };
        fileReader.onerror = (err) => reject(err);
        fileReader.readAsArrayBuffer(pdfFile);
    });
  };

  // Handle message submission and API call
  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if ((input.trim() === "" && !file) || isLoading) return;

    setIsLoading(true);
    setError(null);
    
    let pdfText = "";

    // If a file is attached, parse it first.
    if (file) {
        try {
            pdfText = await parsePdf(file);
            console.log("--- Parsed PDF Content ---");
            console.log(pdfText);
            console.log("--------------------------");
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Failed to parse PDF.";
            setError(errorMessage);
            setIsLoading(false);
            return;
        }
    }

    // Create the user message for the UI with only the typed text.
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim() || `File uploaded: ${file?.name}`, // Show filename if input is empty
    };
    
    // Add the new user message to the UI state.
    setMessages((prev) => [...prev, userMessage]);
    
    // Prepare the text for the API request.
    // This includes the user's typed message and the parsed PDF content.
    let apiRequestText = input.trim();
    if (pdfText) {
        apiRequestText += `\n\n--- Content from ${file?.name} ---\n${pdfText}`;
    }

    // Reset the input fields after preparing the data.
    setInput("");
    setFile(null);

    // Prepare the complete chat history for the API.
    const chatHistory: ApiContent[] = [
        ...messages.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        })),
        {
            role: 'user',
            parts: [{ text: apiRequestText }]
        }
    ];

    try {
        const apiKey = "";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?key=${apiKey}&alt=sse`;
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: chatHistory }),
        });

        if (!response.ok || !response.body) {
            const errorBody = await response.json();
            throw new Error(`API error: ${response.status} - ${errorBody?.error?.message || 'Unknown error'}`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let aiResponseContent = '';
        let assistantMessageId: string | null = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.substring(6).trim();
                    if (jsonStr) {
                         try {
                            const parsed = JSON.parse(jsonStr);
                            const textPart = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                            
                            if (textPart) {
                                aiResponseContent += textPart;
                                if (!assistantMessageId) {
                                    assistantMessageId = crypto.randomUUID();
                                    setMessages(prev => [...prev, { id: assistantMessageId!, role: 'assistant', content: aiResponseContent }]);
                                } else {
                                    setMessages(prev => prev.map(msg => 
                                        msg.id === assistantMessageId ? { ...msg, content: aiResponseContent } : msg
                                    ));
                                }
                            }
                        } catch (e) {
                             console.error("Failed to parse JSON chunk:", jsonStr, e);
                        }
                    }
                }
            }
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
        setError(errorMessage);
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: `Sorry, something went wrong: ${errorMessage}` }]);
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/20">
      <Card className="w-full max-w-2xl h-[80vh] flex flex-col shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="w-6 h-6" />
            <span>AI Chatbot</span>
          </CardTitle>
        </CardHeader>

        <CardContent className="flex-grow overflow-hidden">
          <ScrollArea className="h-full pr-4">
            <div className="flex flex-col gap-4">
              {messages.map((message) => (
                <div key={message.id} className={`flex items-start gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  {message.role === "assistant" && (<Avatar className="w-8 h-8"><AvatarFallback><Bot size={20}/></AvatarFallback></Avatar>)}
                  <div className={`rounded-lg px-4 py-2 max-w-[80%] whitespace-pre-wrap ${message.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    {message.content}
                  </div>
                  {message.role === "user" && (<Avatar className="w-8 h-8"><AvatarFallback><User size={20}/></AvatarFallback></Avatar>)}
                </div>
              ))}
              {isLoading && (
                 <div className="flex items-start gap-3 justify-start">
                    <Avatar className="w-8 h-8"><AvatarFallback><Bot size={20}/></AvatarFallback></Avatar>
                    <div className="rounded-lg px-4 py-2 max-w-[80%] bg-muted"><span className="animate-pulse">Typing...</span></div>
                 </div>
              )}
               {error && (<div className="flex justify-center"><p className="text-red-500 text-sm px-4 text-center">{error}</p></div>)}
              <div ref={scrollAreaRef} /> 
            </div>
          </ScrollArea>
        </CardContent>

        <CardFooter className="flex flex-col items-start gap-2">
            {file && (
                <div className="flex items-center justify-between w-full bg-muted/50 px-3 py-2 rounded-lg text-sm">
                    <span className="truncate">Attached: {file.name}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFile(null)}>
                        <XCircle className="h-4 w-4" />
                    </Button>
                </div>
            )}
          <form onSubmit={handleSendMessage} className="flex items-center w-full gap-2">
            <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()}>
                <Paperclip className="w-5 h-5" />
                <span className="sr-only">Attach file</span>
            </Button>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".pdf" className="hidden" />
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your message or upload a file..." disabled={isLoading} autoComplete="off" />
            <Button type="submit" size="icon" disabled={isLoading || (!input.trim() && !file)}>
              <Send className="w-4 h-4" />
              <span className="sr-only">Send</span>
            </Button>
          </form>
        </CardFooter>
      </Card>
    </div>
  );
}

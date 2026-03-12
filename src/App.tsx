import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, 
  MessageSquare, 
  Upload, 
  Trash2, 
  Camera, 
  Send, 
  History, 
  ChevronRight, 
  Stethoscope, 
  Pill, 
  AlertCircle,
  Loader2,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Session, Message, MedicationFile } from './types';
import { analyzeMedications, getSymptomAdvice, chatWithAI } from './services/gemini';

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [medFiles, setMedFiles] = useState<MedicationFile[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'medication' | 'symptoms'>('chat');
  const [symptomMode, setSymptomMode] = useState<'concise' | 'detailed'>('concise');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSessions();
  }, []);

  useEffect(() => {
    if (currentSessionId) {
      fetchMessages(currentSessionId);
    } else {
      setMessages([]);
    }
  }, [currentSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data);
    } catch (e) {
      console.error("Failed to fetch sessions", e);
    }
  };

  const fetchMessages = async (id: string) => {
    try {
      const res = await fetch(`/api/messages/${id}`);
      const data = await res.json();
      setMessages(data);
    } catch (e) {
      console.error("Failed to fetch messages", e);
    }
  };

  const createNewSession = async () => {
    const id = Date.now().toString();
    const title = `新諮詢 ${new Date().toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
    try {
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title }),
      });
      fetchSessions();
      setCurrentSessionId(id);
      setActiveTab('chat');
    } catch (e) {
      console.error("Failed to create session", e);
    }
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      fetchSessions();
      if (currentSessionId === id) setCurrentSessionId(null);
    } catch (e) {
      console.error("Failed to delete session", e);
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !currentSessionId) return;

    const userMsg: Message = { session_id: currentSessionId, role: 'user', content: inputText };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);

    try {
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userMsg),
      });

      const aiResponse = await chatWithAI(messages.map(m => ({ role: m.role, content: m.content })), inputText);
      const aiMsg: Message = { session_id: currentSessionId, role: 'assistant', content: aiResponse || '抱歉，我現在無法回答。' };
      
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiMsg),
      });

      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file: File) => {
      if (medFiles.length >= 4) return;
      const reader = new FileReader();
      reader.onloadend = () => {
        setMedFiles(prev => [...prev, {
          id: Math.random().toString(36).substr(2, 9),
          preview: reader.result as string,
          name: file.name
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (id: string) => {
    setMedFiles(prev => prev.filter(f => f.id !== id));
  };

  const [symptomResult, setSymptomResult] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState('繁體中文');
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const startCamera = async () => {
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("無法啟動相機，請檢查權限設定。");
      setShowCamera(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setShowCamera(false);
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setMedFiles(prev => [...prev, {
          id: Math.random().toString(36).substr(2, 9),
          preview: dataUrl,
          name: `相機拍攝_${new Date().getTime()}.jpg`
        }]);
        stopCamera();
      }
    }
  };

  const handleAnalyzeMedications = async () => {
    if (medFiles.length === 0) return;
    setIsLoading(true);
    
    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = Date.now().toString();
      const title = `藥物分析 ${new Date().toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, title }),
      });
      fetchSessions();
      setCurrentSessionId(sessionId);
    }

    try {
      const result = await analyzeMedications(medFiles.map(f => f.preview), targetLanguage);
      const aiMsg: Message = { 
        session_id: sessionId, 
        role: 'assistant', 
        content: `### 藥物分析與翻譯報告 (${targetLanguage})\n\n${result}` 
      };
      
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiMsg),
      });

      setMessages(prev => [...prev, aiMsg]);
      setActiveTab('chat');
      setMedFiles([]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSymptomSubmit = async (symptoms: string) => {
    if (!symptoms.trim()) return;
    setIsLoading(true);
    setSymptomResult(null);

    try {
      const result = await getSymptomAdvice(symptoms, symptomMode);
      setSymptomResult(result);
      
      // Still save to history for record keeping
      let sessionId = currentSessionId;
      if (!sessionId) {
        sessionId = Date.now().toString();
        const title = `症狀諮詢 ${new Date().toLocaleString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
        await fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: sessionId, title }),
        });
        fetchSessions();
        setCurrentSessionId(sessionId);
      }

      const aiMsg: Message = { 
        session_id: sessionId, 
        role: 'assistant', 
        content: `### 症狀建議 (${symptomMode === 'concise' ? '簡潔' : '詳細'})\n\n${result}` 
      };
      
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(aiMsg),
      });
      setMessages(prev => [...prev, aiMsg]);

    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-slate-800 font-sans">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 280 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        className="bg-white border-r border-slate-200 overflow-hidden flex flex-col"
      >
        <div className="p-4 border-bottom border-slate-100">
          <button 
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-xl transition-all shadow-sm font-medium"
          >
            <Plus size={18} />
            新諮詢對話
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map(session => (
            <div 
              key={session.id}
              onClick={() => setCurrentSessionId(session.id)}
              className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors ${currentSessionId === session.id ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-slate-50'}`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <History size={16} className={currentSessionId === session.id ? 'text-emerald-600' : 'text-slate-400'} />
                <span className="truncate text-sm font-medium">{session.title}</span>
              </div>
              <button 
                onClick={(e) => deleteSession(session.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-100 text-xs text-slate-400 text-center">
          嬰幼兒用藥安全助手 v1.0
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 z-10">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"
            >
              <History size={20} />
            </button>
            <h1 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Stethoscope className="text-emerald-600" size={22} />
              嬰幼兒用藥安全助手
            </h1>
          </div>

          <nav className="flex bg-slate-100 p-1 rounded-xl">
            <button 
              onClick={() => setActiveTab('chat')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'chat' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              諮詢對話
            </button>
            <button 
              onClick={() => setActiveTab('medication')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'medication' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              藥物辨識
            </button>
            <button 
              onClick={() => setActiveTab('symptoms')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'symptoms' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              症狀建議
            </button>
          </nav>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto h-full flex flex-col">
            <AnimatePresence mode="wait">
              {activeTab === 'chat' && (
                <motion.div 
                  key="chat"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="flex-1 flex flex-col gap-4"
                >
                  {messages.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-12 space-y-6">
                      <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                        <MessageSquare size={40} />
                      </div>
                      <div className="max-w-md">
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">開始您的專業諮詢</h2>
                        <p className="text-slate-500">您可以點擊上方標籤上傳藥物照片，或直接在此輸入嬰幼兒的健康問題。</p>
                      </div>
                      <div className="grid grid-cols-2 gap-4 w-full max-w-lg">
                        <button onClick={() => setActiveTab('medication')} className="p-4 bg-white border border-slate-200 rounded-2xl hover:border-emerald-500 transition-all text-left group">
                          <Pill className="text-emerald-600 mb-2 group-hover:scale-110 transition-transform" />
                          <div className="font-semibold">辨識藥物風險</div>
                          <div className="text-xs text-slate-400">上傳藥袋或藥瓶照片</div>
                        </button>
                        <button onClick={() => setActiveTab('symptoms')} className="p-4 bg-white border border-slate-200 rounded-2xl hover:border-emerald-500 transition-all text-left group">
                          <AlertCircle className="text-amber-500 mb-2 group-hover:scale-110 transition-transform" />
                          <div className="font-semibold">症狀用藥建議</div>
                          <div className="text-xs text-slate-400">針對嬰兒症狀快速查詢</div>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6 pb-24">
                      {messages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm ${msg.role === 'user' ? 'bg-emerald-600 text-white rounded-tr-none' : 'bg-white border border-slate-100 rounded-tl-none'}`}>
                            <div className="prose prose-slate max-w-none prose-sm">
                              {msg.content.split('\n').map((line, j) => (
                                <p key={j} className="mb-1">{line}</p>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                      {isLoading && (
                        <div className="flex justify-start">
                          <div className="bg-white border border-slate-100 p-4 rounded-2xl rounded-tl-none flex items-center gap-2">
                            <Loader2 size={16} className="animate-spin text-emerald-600" />
                            <span className="text-sm text-slate-500">正在分析中...</span>
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'medication' && (
                <motion.div 
                  key="medication"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="flex-1 flex flex-col items-center justify-center"
                >
                  <div className="w-full max-w-2xl bg-white p-8 rounded-3xl shadow-xl border border-slate-100">
                    <div className="text-center mb-6">
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">藥物辨識與翻譯分析</h2>
                      <p className="text-slate-500">支援多國語言翻譯，請選擇拍照或上傳檔案。</p>
                    </div>

                    <div className="mb-6">
                      <label className="block text-sm font-semibold text-slate-700 mb-2">翻譯目標語言</label>
                      <select 
                        value={targetLanguage}
                        onChange={(e) => setTargetLanguage(e.target.value)}
                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="繁體中文">繁體中文</option>
                        <option value="簡體中文">簡體中文</option>
                        <option value="English">English</option>
                        <option value="日本語">日本語</option>
                        <option value="Tiếng Việt">Tiếng Việt</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-8">
                      {medFiles.map(file => (
                        <div key={file.id} className="relative aspect-video rounded-xl overflow-hidden border border-slate-200 group">
                          <img src={file.preview} alt="preview" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="text-white text-xs font-medium truncate px-2">{file.name}</span>
                          </div>
                          <button 
                            onClick={() => removeFile(file.id)}
                            className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full shadow-md"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      
                      {medFiles.length < 4 && (
                        <>
                          <button 
                            onClick={startCamera}
                            className="aspect-video rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-2 hover:border-emerald-500 hover:bg-emerald-50 transition-all text-slate-400 hover:text-emerald-600"
                          >
                            <Camera size={32} />
                            <span className="text-sm font-medium">拍照辨識</span>
                          </button>
                          <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="aspect-video rounded-xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center gap-2 hover:border-emerald-500 hover:bg-emerald-50 transition-all text-slate-400 hover:text-emerald-600"
                          >
                            <Upload size={32} />
                            <span className="text-sm font-medium">上傳檔案</span>
                          </button>
                        </>
                      )}
                    </div>

                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileUpload} 
                      accept="image/*,application/pdf" 
                      multiple 
                      className="hidden" 
                    />

                    <button 
                      onClick={handleAnalyzeMedications}
                      disabled={medFiles.length === 0 || isLoading}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white py-4 rounded-2xl font-bold text-lg transition-all shadow-lg flex items-center justify-center gap-2"
                    >
                      {isLoading ? <Loader2 className="animate-spin" /> : <Upload size={20} />}
                      開始辨識與翻譯
                    </button>
                  </div>

                  {/* Camera Modal */}
                  {showCamera && (
                    <div className="fixed inset-0 bg-black z-50 flex flex-col">
                      <div className="flex-1 relative flex items-center justify-center">
                        <video ref={videoRef} autoPlay playsInline className="max-h-full max-w-full" />
                        <canvas ref={canvasRef} className="hidden" />
                      </div>
                      <div className="h-32 bg-slate-900 flex items-center justify-around px-8">
                        <button onClick={stopCamera} className="p-4 text-white hover:bg-white/10 rounded-full">
                          <X size={32} />
                        </button>
                        <button onClick={takePhoto} className="w-20 h-20 bg-white rounded-full border-4 border-slate-400 flex items-center justify-center">
                          <div className="w-16 h-16 bg-white rounded-full border-2 border-slate-900" />
                        </button>
                        <div className="w-12" /> {/* Spacer */}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'symptoms' && (
                <motion.div 
                  key="symptoms"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="flex-1 flex flex-col items-center"
                >
                  <div className="w-full max-w-2xl bg-white p-8 rounded-3xl shadow-xl border border-slate-100 mb-6">
                    <div className="text-center mb-8">
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">嬰兒症狀用藥建議</h2>
                      <p className="text-slate-500">請描述嬰兒目前的症狀，建議將直接顯示於下方。</p>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">症狀描述</label>
                        <textarea 
                          className="w-full h-32 p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none resize-none"
                          placeholder="例如：六個月大的嬰兒發燒 38.5 度，伴隨輕微咳嗽..."
                          id="symptomInput"
                        ></textarea>
                      </div>

                      <div className="flex gap-4">
                        <button 
                          onClick={() => setSymptomMode('concise')}
                          className={`flex-1 py-3 rounded-xl font-medium border transition-all ${symptomMode === 'concise' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-white border-slate-200 text-slate-500'}`}
                        >
                          簡潔模式
                        </button>
                        <button 
                          onClick={() => setSymptomMode('detailed')}
                          className={`flex-1 py-3 rounded-xl font-medium border transition-all ${symptomMode === 'detailed' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-white border-slate-200 text-slate-500'}`}
                        >
                          詳細模式
                        </button>
                      </div>

                      <button 
                        onClick={() => {
                          const val = (document.getElementById('symptomInput') as HTMLTextAreaElement).value;
                          handleSymptomSubmit(val);
                        }}
                        disabled={isLoading}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white py-4 rounded-2xl font-bold text-lg transition-all shadow-lg flex items-center justify-center gap-2"
                      >
                        {isLoading ? <Loader2 className="animate-spin" /> : <ChevronRight size={20} />}
                        獲取建議
                      </button>
                    </div>
                  </div>

                  {/* Inline Result Display */}
                  <AnimatePresence>
                    {symptomResult && (
                      <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full max-w-2xl bg-white p-8 rounded-3xl shadow-lg border border-emerald-100"
                      >
                        <div className="flex items-center gap-2 text-emerald-600 mb-4">
                          <Stethoscope size={20} />
                          <h3 className="font-bold text-lg">專業建議結果</h3>
                        </div>
                        <div className="prose prose-slate max-w-none">
                          {symptomResult.split('\n').map((line, i) => (
                            <p key={i} className="mb-2 text-slate-700">{line}</p>
                          ))}
                        </div>
                        <div className="mt-6 pt-6 border-t border-slate-100 flex justify-between items-center">
                          <span className="text-xs text-slate-400">此建議已同步儲存至對話紀錄</span>
                          <button 
                            onClick={() => setActiveTab('chat')}
                            className="text-emerald-600 text-sm font-semibold hover:underline"
                          >
                            前往對話詳談
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Input Bar (Only in Chat Tab) */}
        {activeTab === 'chat' && currentSessionId && (
          <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#F8FAFC] via-[#F8FAFC] to-transparent">
            <div className="max-w-4xl mx-auto relative">
              <input 
                type="text" 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="輸入您的問題..."
                className="w-full bg-white border border-slate-200 rounded-2xl py-4 pl-6 pr-16 shadow-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none"
              />
              <button 
                onClick={handleSendMessage}
                disabled={!inputText.trim() || isLoading}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:bg-slate-300 transition-all shadow-md"
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

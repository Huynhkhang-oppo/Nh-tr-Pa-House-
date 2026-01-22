
import React, { useState, useEffect, useMemo } from 'react';
import { Room, Reading } from './types';
import { DEFAULT_ROOMS, CURRENCY_FORMATTER } from './constants';
import { analyzeRentalData } from './services/geminiService';

type ViewMode = 'landing' | 'admin' | 'tenant';
type AdminTab = 'bills' | 'unc' | 'settings';

function getPrevMonth(monthStr: string) {
  const [y, m] = monthStr.split('-').map(Number);
  const date = new Date(y, m - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getNextMonth(monthStr: string) {
  const [y, m] = monthStr.split('-').map(Number);
  const date = new Date(y, m, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('landing');
  const [adminTab, setAdminTab] = useState<AdminTab>('bills');
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [loginTarget, setLoginTarget] = useState<{ type: 'admin' | 'room', id?: string } | null>(null);
  const [pinBuffer, setPinBuffer] = useState('');
  const [viewingReceipt, setViewingReceipt] = useState<string | null>(null);
  
  const [adminPin, setAdminPin] = useState(() => localStorage.getItem('adminPin') || '1234');
  const [globalElecRate, setGlobalElecRate] = useState(() => Number(localStorage.getItem('globalElecRate')) || 3500);
  const [globalWaterRate, setGlobalWaterRate] = useState(() => Number(localStorage.getItem('globalWaterRate')) || 25000);
  const [globalServiceFee, setGlobalServiceFee] = useState(() => Number(localStorage.getItem('globalServiceFee')) || 150000);
  const [globalOtherFee, setGlobalOtherFee] = useState(() => Number(localStorage.getItem('globalOtherFee')) || 0);

  const [paymentQrCode, setPaymentQrCode] = useState(() => localStorage.getItem('paymentQrCode') || '');
  const [paymentDescription, setPaymentDescription] = useState(() => localStorage.getItem('paymentDescription') || 'Chuyển khoản: [Ngân hàng] - [Số tài khoản] - [Tên chủ tài khoản]');
  const [cloudApiUrl, setCloudApiUrl] = useState(() => localStorage.getItem('cloudApiUrl') || '');

  const [rooms, setRooms] = useState<Room[]>(() => {
    const saved = localStorage.getItem('rooms');
    return saved ? JSON.parse(saved) : DEFAULT_ROOMS;
  });
  
  const [readings, setReadings] = useState<Reading[]>(() => {
    const saved = localStorage.getItem('readings');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem('rooms', JSON.stringify(rooms)); }, [rooms]);
  useEffect(() => { localStorage.setItem('readings', JSON.stringify(readings)); }, [readings]);
  useEffect(() => { localStorage.setItem('adminPin', adminPin); }, [adminPin]);
  useEffect(() => { localStorage.setItem('globalElecRate', globalElecRate.toString()); }, [globalElecRate]);
  useEffect(() => { localStorage.setItem('globalWaterRate', globalWaterRate.toString()); }, [globalWaterRate]);
  useEffect(() => { localStorage.setItem('globalServiceFee', globalServiceFee.toString()); }, [globalServiceFee]);
  useEffect(() => { localStorage.setItem('globalOtherFee', globalOtherFee.toString()); }, [globalOtherFee]);
  useEffect(() => { localStorage.setItem('paymentQrCode', paymentQrCode); }, [paymentQrCode]);
  useEffect(() => { localStorage.setItem('paymentDescription', paymentDescription); }, [paymentDescription]);
  useEffect(() => { localStorage.setItem('cloudApiUrl', cloudApiUrl); }, [cloudApiUrl]);

  useEffect(() => {
    const currentMonthReadings = readings.filter(r => r.month === selectedMonth);
    if (currentMonthReadings.length !== rooms.length) {
      setReadings(prev => {
        const newReadings = [...prev];
        let hasChanged = false;
        rooms.forEach(room => {
          const exists = prev.find(r => r.roomId === room.id && r.month === selectedMonth);
          if (!exists) {
            hasChanged = true;
            const prevMonth = getPrevMonth(selectedMonth);
            const prevData = prev.find(r => r.roomId === room.id && r.month === prevMonth);
            newReadings.push({
              roomId: room.id,
              month: selectedMonth,
              prevElectricity: prevData ? prevData.currElectricity : 0,
              currElectricity: prevData ? prevData.currElectricity : 0,
              prevWater: prevData ? prevData.currWater : 0,
              currWater: prevData ? prevData.currWater : 0,
              otherFees: 0,
              paid: false
            });
          }
        });
        return hasChanged ? newReadings : prev;
      });
    }
  }, [selectedMonth, rooms.length]);

  const updateReading = (roomId: string, field: keyof Reading, value: any) => {
    setReadings(prev => {
      const updated = prev.map(r => (r.roomId === roomId && r.month === selectedMonth) ? { ...r, [field]: value } : r);
      if (field === 'currElectricity' || field === 'currWater') {
        const nextMonth = getNextMonth(selectedMonth);
        const prevField = field === 'currElectricity' ? 'prevElectricity' : 'prevWater';
        return updated.map(r => (r.roomId === roomId && r.month === nextMonth) ? { ...r, [prevField]: value } : r);
      }
      return updated;
    });
  };

  const updateRoomConfig = (roomId: string, field: keyof Room, value: any) => {
    setRooms(prev => prev.map(r => r.id === roomId ? { ...r, [field]: value } : r));
  };

  const calculateRoomTotal = (room: Room, reading?: Reading) => {
    if (!reading) return room.baseRent + globalServiceFee + globalOtherFee;
    const elecUsage = Math.max(0, reading.currElectricity - reading.prevElectricity);
    const waterUsage = Math.max(0, reading.currWater - reading.prevWater);
    return room.baseRent + (elecUsage * globalElecRate) + (waterUsage * globalWaterRate) + globalServiceFee + globalOtherFee + (reading.otherFees || 0);
  };

  const exportToExcel = () => {
    const currentReadings = readings.filter(r => r.month === selectedMonth);
    const headers = ["Phòng", "Chỉ số Điện Cũ", "Chỉ số Điện Mới", "Tiêu thụ Điện", "Chỉ số Nước Cũ", "Chỉ số Nước Mới", "Tiêu thụ Nước", "Tiền Phòng", "Tổng Tiền", "Trạng thái"];
    const rows = rooms.map(room => {
      const r = currentReadings.find(x => x.roomId === room.id);
      if (!r) return [];
      const eUsage = r.currElectricity - r.prevElectricity;
      const wUsage = r.currWater - r.prevWater;
      const total = calculateRoomTotal(room, r);
      return [room.name, r.prevElectricity, r.currElectricity, eUsage, r.prevWater, r.currWater, wUsage, room.baseRent, total, r.paid ? "Đã thanh toán" : "Chưa thanh toán"];
    });

    let csvContent = "\uFEFF"; // BOM for UTF-8
    csvContent += headers.join(",") + "\n";
    rows.forEach(row => { csvContent += row.join(",") + "\n"; });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Bao_Cao_Tro_Thang_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const currentReadings = useMemo(() => readings.filter(r => r.month === selectedMonth), [readings, selectedMonth]);

  const stats = useMemo(() => {
    let total = 0, collected = 0;
    currentReadings.forEach(r => {
      const room = rooms.find(rm => rm.id === r.roomId);
      if (room) {
        const amt = calculateRoomTotal(room, r);
        total += amt;
        if (r.paid) collected += amt;
      }
    });
    return { total, collected, unpaid: total - collected };
  }, [currentReadings, rooms, globalElecRate, globalWaterRate, globalServiceFee, globalOtherFee]);

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginTarget) return;
    if (loginTarget.type === 'admin') {
      if (pinBuffer === adminPin) { setViewMode('admin'); setLoginTarget(null); }
      else alert("Mã PIN Chủ nhà không đúng!");
    } else {
      const room = rooms.find(r => r.id === loginTarget.id);
      if (room && pinBuffer === room.pin) { setActiveTenantId(room.id); setViewMode('tenant'); setLoginTarget(null); }
      else alert("Mã PIN của phòng không đúng!");
    }
    setPinBuffer('');
  };

  // Fixed missing handleReceiptUpload implementation
  const handleReceiptUpload = (roomId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        updateReading(roomId, 'receiptImage', reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const renderLandingPage = () => (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        <div className="text-white space-y-6">
          <h1 className="text-5xl font-black tracking-tighter">RentalManager <span className="text-blue-500">Pro</span></h1>
          <p className="text-slate-400 text-lg font-medium leading-relaxed">Phần mềm quản lý trọ thay thế Excel. Tự động đồng bộ & Phân tích AI.</p>
        </div>
        <div className="space-y-4">
          {!loginTarget ? (
            <>
              <button onClick={() => setLoginTarget({ type: 'admin' })} className="w-full bg-white p-6 rounded-3xl shadow-xl flex items-center gap-5 transition-all hover:scale-[1.02]">
                <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-2xl shadow-lg">💎</div>
                <div className="text-left"><div className="font-black text-slate-900 text-xl">Chủ Nhà</div><div className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Quản lý toàn khu</div></div>
              </button>
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-[2.5rem] border border-white/10 shadow-2xl">
                <div className="font-black text-white mb-6 flex items-center gap-3 text-lg pb-4 border-b border-white/10"><span className="text-blue-500 text-2xl">🏠</span> Khách Thuê</div>
                <div className="grid grid-cols-2 gap-3">
                  {rooms.map(r => (
                    <button key={r.id} onClick={() => setLoginTarget({ type: 'room', id: r.id })} className="p-4 bg-white/5 hover:bg-blue-600 text-white rounded-2xl text-sm font-black transition-all border border-white/5 active:scale-95">{r.name}</button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <form onSubmit={handleAuth} className="w-full bg-white p-8 rounded-[2.5rem] shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="flex justify-between items-center mb-6">
                <h3 className="font-black text-slate-900 text-xl tracking-tight">{loginTarget.type === 'admin' ? 'Chủ nhà đăng nhập' : `Mã PIN ${rooms.find(r => r.id === loginTarget.id)?.name}`}</h3>
                <button type="button" onClick={() => setLoginTarget(null)} className="text-slate-400 font-bold px-2 py-1">Hủy</button>
              </div>
              <input autoFocus type="password" value={pinBuffer} onChange={(e) => setPinBuffer(e.target.value)} placeholder="••••" className="w-full bg-slate-100 border-none rounded-2xl p-5 text-center text-4xl font-black tracking-[0.5em] focus:ring-4 focus:ring-blue-100 outline-none mb-6" maxLength={6} />
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg hover:bg-blue-700 shadow-xl transition-all">ĐĂNG NHẬP</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  const renderAdminView = () => (
    <div className="min-h-screen pb-20 bg-slate-50">
      {viewingReceipt && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4" onClick={() => setViewingReceipt(null)}>
           <div className="max-w-2xl w-full bg-white rounded-[2rem] p-6 animate-in zoom-in duration-300" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4 border-b pb-4"><h3 className="font-black text-slate-900">Ảnh UNC Minh chứng</h3><button onClick={() => setViewingReceipt(null)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-black">✕</button></div>
              <img src={viewingReceipt} alt="Receipt" className="w-full h-auto max-h-[70vh] object-contain rounded-xl" />
           </div>
        </div>
      )}

      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-50 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={() => setViewMode('landing')} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 text-slate-600 hover:bg-blue-600 hover:text-white transition-all">←</button>
          <h1 className="text-xl font-black text-slate-900">Dashboard</h1>
        </div>
        <nav className="flex bg-slate-100 p-1 rounded-xl shadow-inner gap-1">
          <button onClick={() => setAdminTab('bills')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${adminTab === 'bills' ? 'bg-white shadow-md text-blue-600' : 'text-slate-500'}`}>🧾 Hóa đơn</button>
          <button onClick={() => setAdminTab('unc')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${adminTab === 'unc' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500'}`}>📸 UNC</button>
          <button onClick={() => setAdminTab('settings')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${adminTab === 'settings' ? 'bg-white shadow-md text-slate-800' : 'text-slate-500'}`}>⚙️ Cài đặt</button>
        </nav>
        <div className="flex items-center gap-3">
          <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="border-none rounded-xl px-4 py-2 text-sm font-black bg-slate-100 outline-none" />
          <button onClick={async () => { setIsAiLoading(true); setAiAnalysis(await analyzeRentalData(rooms, readings, selectedMonth)); setIsAiLoading(false); }} className="bg-blue-600 text-white px-5 py-2 rounded-xl text-sm font-black hover:bg-blue-700">{isAiLoading ? '⌛' : '✨ AI'}</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8 animate-in fade-in duration-500">
        {/* Render AI Analysis results when available */}
        {aiAnalysis && (
          <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl border border-blue-100 relative overflow-hidden animate-in slide-in-from-top-4 duration-300">
            <div className="absolute top-0 right-0 p-4">
              <button onClick={() => setAiAnalysis(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:text-rose-500 font-black transition-colors">✕</button>
            </div>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-2xl">✨</span>
              <h2 className="font-black text-slate-900 uppercase tracking-widest text-sm">Phân tích AI từ Gemini</h2>
            </div>
            <div className="prose prose-slate max-w-none text-slate-700 text-sm leading-relaxed whitespace-pre-wrap font-medium">
              {aiAnalysis}
            </div>
          </div>
        )}

        {adminTab === 'bills' ? (
          <div className="bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-100">
            <div className="p-8 bg-slate-50/50 border-b flex justify-between items-center">
               <div className="flex items-center gap-4">
                  <h2 className="font-black text-slate-900 uppercase tracking-widest text-sm">Tháng {selectedMonth}</h2>
                  <button onClick={exportToExcel} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-all shadow-lg shadow-green-500/20">📥 Xuất File Excel (CSV)</button>
               </div>
               <div className="flex gap-8">
                  <div className="text-right"><p className="text-[10px] text-slate-500 font-black mb-1">DỰ THU</p><p className="text-xl font-black text-blue-600">{CURRENCY_FORMATTER.format(stats.total)}</p></div>
                  <div className="text-right"><p className="text-[10px] text-green-600 font-black mb-1">ĐÃ THU</p><p className="text-xl font-black text-green-600">{CURRENCY_FORMATTER.format(stats.collected)}</p></div>
               </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left"><thead className="bg-slate-50 text-slate-500 text-[10px] font-black uppercase"><tr><th className="px-8 py-5">Phòng</th><th className="px-6 py-5">Điện</th><th className="px-6 py-5">Nước</th><th className="px-6 py-5 text-right">Tổng cộng</th><th className="px-8 py-5 text-center">Trạng thái</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rooms.map(room => {
                    const r = currentReadings.find(x => x.roomId === room.id);
                    if (!r) return null;
                    return (
                      <tr key={room.id} className="hover:bg-blue-50/30 transition-colors">
                        <td className="px-8 py-6 font-black text-slate-900">{room.name}</td>
                        <td className="px-6 py-6"><input type="number" value={r.currElectricity} onChange={(e) => updateReading(room.id, 'currElectricity', Number(e.target.value))} className="w-20 bg-blue-50 rounded-xl px-3 py-1.5 font-black text-blue-600 border border-blue-100" /></td>
                        <td className="px-6 py-6"><input type="number" value={r.currWater} onChange={(e) => updateReading(room.id, 'currWater', Number(e.target.value))} className="w-20 bg-indigo-50 rounded-xl px-
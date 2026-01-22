
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
  // --- States ---
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

  // --- Sync to LocalStorage ---
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

  // --- Logic ---
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
              prevWater: prevData ? prevData.prevWater : 0,
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

  const calculateRoomTotal = (room: Room, reading?: Reading) => {
    if (!reading) return room.baseRent + globalServiceFee + globalOtherFee;
    const elecUsage = Math.max(0, reading.currElectricity - reading.prevElectricity);
    const waterUsage = Math.max(0, reading.currWater - reading.prevWater);
    return room.baseRent + (elecUsage * globalElecRate) + (waterUsage * globalWaterRate) + globalServiceFee + globalOtherFee + (reading.otherFees || 0);
  };

  const exportToExcel = () => {
    const currentMonthReadings = readings.filter(r => r.month === selectedMonth);
    const headers = ["Phòng", "Chỉ số Điện Cũ", "Chỉ số Điện Mới", "Tiêu thụ Điện", "Chỉ số Nước Cũ", "Chỉ số Nước Mới", "Tiêu thụ Nước", "Tiền Phòng", "Tổng Tiền", "Trạng thái"];
    const rows = rooms.map(room => {
      const r = currentMonthReadings.find(x => x.roomId === room.id);
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
    link.setAttribute("download", `Bao_Cao_Nha_Tro_Thang_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleReceiptUpload = (roomId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        updateReading(roomId, 'receiptImage', reader.result as string);
        alert("Đã tải ảnh minh chứng thành công!");
      };
      reader.readAsDataURL(file);
    }
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

  // --- Render Functions ---
  const renderLandingPage = () => (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        <div className="text-white space-y-6">
          <h1 className="text-5xl font-black tracking-tighter">RentalManager <span className="text-blue-500">Pro</span></h1>
          <p className="text-slate-400 text-lg font-medium leading-relaxed">Hệ thống quản lý phòng trọ chuyên nghiệp. Tự động hóa, Minh bạch và Bảo mật.</p>
        </div>
        <div className="space-y-4">
          {!loginTarget ? (
            <>
              <button onClick={() => setLoginTarget({ type: 'admin' })} className="w-full bg-white p-6 rounded-3xl shadow-xl flex items-center gap-5 transition-all hover:scale-[1.02]">
                <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-2xl shadow-lg">💎</div>
                <div className="text-left">
                  <div className="font-black text-slate-900 text-xl">Chủ Nhà</div>
                  <div className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Dashboard Quản lý</div>
                </div>
              </button>
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-[2.5rem] border border-white/10 shadow-2xl">
                <div className="font-black text-white mb-6 flex items-center gap-3 text-lg pb-4 border-b border-white/10">🏠 Khách Thuê</div>
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
                <h3 className="font-black text-slate-900 text-xl tracking-tight">{loginTarget.type === 'admin' ? 'Xác thực Chủ nhà' : `Mã PIN ${rooms.find(r => r.id === loginTarget.id)?.name}`}</h3>
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
              <div className="flex justify-between items-center mb-4 border-b pb-4"><h3 className="font-black text-slate-900">Chi tiết UNC</h3><button onClick={() => setViewingReceipt(null)} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-black">✕</button></div>
              <img src={viewingReceipt} alt="Receipt" className="w-full h-auto max-h-[70vh] object-contain rounded-xl" />
           </div>
        </div>
      )}

      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-50 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={() => setViewMode('landing')} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 text-slate-600 hover:bg-blue-600 hover:text-white transition-all">←</button>
          <h1 className="text-xl font-black text-slate-900">Chủ Nhà</h1>
        </div>
        <nav className="flex bg-slate-100 p-1 rounded-xl shadow-inner gap-1">
          <button onClick={() => setAdminTab('bills')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${adminTab === 'bills' ? 'bg-white shadow-md text-blue-600' : 'text-slate-500'}`}>🧾 Hóa đơn</button>
          <button onClick={() => setAdminTab('unc')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${adminTab === 'unc' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500'}`}>📸 UNC</button>
          <button onClick={() => setAdminTab('settings')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${adminTab === 'settings' ? 'bg-white shadow-md text-slate-800' : 'text-slate-500'}`}>⚙️ Cài đặt</button>
        </nav>
        <div className="flex items-center gap-3">
          <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="border-none rounded-xl px-4 py-2 text-sm font-black bg-slate-100 outline-none" />
          <button onClick={async () => { setIsAiLoading(true); setAiAnalysis(await analyzeRentalData(rooms, readings, selectedMonth)); setIsAiLoading(false); }} className="bg-blue-600 text-white px-5 py-2 rounded-xl text-sm font-black hover:bg-blue-700 shadow-lg shadow-blue-500/20">{isAiLoading ? '⌛ Phân tích...' : '✨ Phân tích AI'}</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8 animate-in fade-in duration-500">
        {aiAnalysis && (
          <div className="bg-white p-8 rounded-[2.5rem] shadow-2xl border border-blue-100 relative overflow-hidden animate-in slide-in-from-top-6">
            <div className="absolute top-0 right-0 p-4">
              <button onClick={() => setAiAnalysis(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:text-rose-500 font-black transition-colors">✕</button>
            </div>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-2xl">💡</span>
              <h2 className="font-black text-slate-900 uppercase tracking-widest text-sm">Gợi ý từ Trợ lý AI Gemini</h2>
            </div>
            <div className="prose prose-slate max-w-none text-slate-700 text-sm leading-relaxed whitespace-pre-wrap font-medium bg-blue-50/30 p-6 rounded-2xl border border-blue-50">
              {aiAnalysis}
            </div>
          </div>
        )}

        {adminTab === 'bills' ? (
          <div className="bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-slate-100">
            <div className="p-8 bg-slate-50/50 border-b flex justify-between items-center">
               <div className="flex items-center gap-4">
                  <h2 className="font-black text-slate-900 uppercase tracking-widest text-sm">Tháng {selectedMonth}</h2>
                  <button onClick={exportToExcel} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase flex items-center gap-2 transition-all shadow-lg shadow-green-500/20">📥 Xuất Excel (CSV)</button>
               </div>
               <div className="flex gap-8">
                  <div className="text-right"><p className="text-[10px] text-slate-500 font-black mb-1">DỰ THU</p><p className="text-xl font-black text-blue-600">{CURRENCY_FORMATTER.format(stats.total)}</p></div>
                  <div className="text-right"><p className="text-[10px] text-green-600 font-black mb-1">ĐÃ THU</p><p className="text-xl font-black text-green-600">{CURRENCY_FORMATTER.format(stats.collected)}</p></div>
               </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left"><thead className="bg-slate-50 text-slate-500 text-[10px] font-black uppercase"><tr><th className="px-8 py-5">Phòng</th><th className="px-6 py-5">Điện</th><th className="px-6 py-5">Nước</th><th className="px-6 py-5 text-right">Tổng tiền</th><th className="px-8 py-5 text-center">Trạng thái</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rooms.map(room => {
                    const r = currentReadings.find(x => x.roomId === room.id);
                    if (!r) return null;
                    return (
                      <tr key={room.id} className="hover:bg-blue-50/30 transition-colors">
                        <td className="px-8 py-6 font-black text-slate-900">{room.name}</td>
                        <td className="px-6 py-6"><input type="number" value={r.currElectricity} onChange={(e) => updateReading(room.id, 'currElectricity', Number(e.target.value))} className="w-20 bg-blue-50 rounded-xl px-3 py-1.5 font-black text-blue-600 border border-blue-100 outline-none" /></td>
                        <td className="px-6 py-6"><input type="number" value={r.currWater} onChange={(e) => updateReading(room.id, 'currWater', Number(e.target.value))} className="w-20 bg-indigo-50 rounded-xl px-3 py-1.5 font-black text-indigo-600 border border-indigo-100 outline-none" /></td>
                        <td className="px-6 py-6 font-black text-right">{CURRENCY_FORMATTER.format(calculateRoomTotal(room, r))}</td>
                        <td className="px-8 py-6"><button onClick={() => updateReading(room.id, 'paid', !r.paid)} className={`w-full py-2.5 rounded-2xl text-[10px] font-black uppercase transition-all ${r.paid ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-600 animate-pulse'}`}>{r.paid ? '✓ Đã thu' : '⏳ Chưa thu'}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : adminTab === 'unc' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-6 duration-500">
            {rooms.map(room => {
              const r = currentReadings.find(x => x.roomId === room.id);
              if (!r || !r.receiptImage) return null;
              return (
                <div key={room.id} className="bg-white rounded-[2rem] shadow-xl border border-slate-100 overflow-hidden group">
                  <div className="p-5 border-b flex justify-between items-center"><h3 className="font-black text-slate-900">{room.name}</h3><span className={`px-2 py-1 rounded-lg text-[8px] font-black uppercase ${r.paid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{r.paid ? 'Đã duyệt' : 'Chờ duyệt'}</span></div>
                  <img src={r.receiptImage} onClick={() => setViewingReceipt(r.receiptImage!)} alt="UNC" className="w-full aspect-video object-cover cursor-pointer hover:scale-105 transition-transform" />
                  <div className="p-4">{!r.paid && <button onClick={() => updateReading(room.id, 'paid', true)} className="w-full bg-indigo-600 text-white py-3 rounded-xl font-black text-xs uppercase shadow-lg shadow-indigo-200">Xác nhận thanh toán</button>}</div>
                </div>
              );
            })}
            {currentReadings.filter(r => r.receiptImage).length === 0 && (
              <div className="col-span-full py-20 text-center text-slate-400 font-bold italic">Chưa có minh chứng thanh toán nào được gửi.</div>
            )}
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-8">
             <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-8 rounded-[2.5rem] shadow-2xl text-white border border-slate-700">
                <div className="flex items-center gap-4 mb-6">
                   <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-2xl shadow-xl">☁️</div>
                   <div><h3 className="font-black text-xl">Cloud Sync (Real-time Sheets)</h3><p className="text-slate-400 text-xs font-medium">Kết nối với Google Sheets qua SheetDB API để đồng bộ dữ liệu đa thiết bị.</p></div>
                </div>
                <div className="space-y-4">
                   <div className="space-y-2">
                      <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest">API URL (Ví dụ: SheetDB.io)</label>
                      <input type="text" value={cloudApiUrl} onChange={(e) => setCloudApiUrl(e.target.value)} placeholder="https://sheetdb.io/api/v1/your_id" className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 font-mono text-xs text-blue-300 outline-none focus:ring-2 focus:ring-blue-500" />
                   </div>
                   <div className="bg-white/5 p-5 rounded-2xl border border-white/5"><h4 className="font-black text-xs uppercase mb-3 text-slate-300">Hướng dẫn:</h4><ol className="text-[11px] text-slate-400 space-y-2 list-decimal ml-4"><li>Tạo Google Sheets mới với các cột: ID, Room, Month, Total, Status.</li><li>Truy cập <a href="https://sheetdb.io" target="_blank" className="text-blue-400 underline">SheetDB.io</a>, dán link Sheets để lấy API.</li><li>Dán API URL vào ô trên để kích hoạt đồng bộ.</li></ol></div>
                </div>
             </div>
             <div className="bg-white p-10 rounded-[3rem] shadow-2xl border border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-8">
               <div className="space-y-3"><label className="text-xs font-black text-slate-600 uppercase">Đơn giá Điện (vnđ/kWh)</label><input type="number" value={globalElecRate} onChange={(e) => setGlobalElecRate(Number(e.target.value))} className="w-full bg-slate-100 rounded-2xl p-4 font-black text-blue-700 outline-none" /></div>
               <div className="space-y-3"><label className="text-xs font-black text-slate-600 uppercase">Đơn giá Nước (vnđ/m³)</label><input type="number" value={globalWaterRate} onChange={(e) => setGlobalWaterRate(Number(e.target.value))} className="w-full bg-slate-100 rounded-2xl p-4 font-black text-indigo-700 outline-none" /></div>
             </div>
          </div>
        )}
      </main>
    </div>
  );

  const renderTenantView = () => {
    const room = rooms.find(r => r.id === activeTenantId);
    const reading = currentReadings.find(r => r.roomId === activeTenantId);
    if (!room || !reading) return null;
    const totalAmount = calculateRoomTotal(room, reading);
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center">
        <header className="w-full bg-white border-b px-6 py-6 flex items-center justify-between max-w-2xl sticky top-0 z-50">
           <button onClick={() => setViewMode('landing')} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 text-slate-600 font-black transition-all hover:bg-slate-200">←</button>
           <h1 className="text-xl font-black text-slate-900 uppercase">{room.name}</h1>
           <div className="text-[10px] font-black uppercase text-blue-600 bg-blue-50 px-4 py-2 rounded-full">Tháng {selectedMonth.split('-')[1]}</div>
        </header>
        <main className="w-full max-w-2xl p-6 space-y-8 animate-in slide-in-from-bottom-8 duration-500 pb-24">
           <div className="bg-gradient-to-br from-indigo-700 to-blue-900 p-10 rounded-[3rem] text-white shadow-2xl relative overflow-hidden">
              <p className="text-blue-200 text-xs font-black uppercase tracking-widest opacity-80 mb-3">Tổng thanh toán</p>
              <p className="text-5xl font-black leading-none tracking-tighter mb-8">{CURRENCY_FORMATTER.format(totalAmount)}</p>
              <div className="flex justify-between items-center"><span className={`px-6 py-3 rounded-2xl text-[10px] font-black tracking-widest border transition-all ${reading.paid ? 'bg-green-500/30 text-green-300 border-green-500/40' : 'bg-rose-500/30 text-rose-300 border-rose-500/40 animate-pulse'}`}>{reading.paid ? '✓ ĐÃ THANH TOÁN' : '⏳ CHỜ THANH TOÁN'}</span></div>
           </div>
           <div className="grid grid-cols-1 gap-6">
              <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-xl">
                 <div className="flex justify-between items-center mb-6"><label className="text-[11px] font-black text-slate-500 uppercase tracking-widest">⚡ Điện (kWh)</label></div>
                 <div className="flex gap-4"><div className="flex-1 bg-slate-50 p-6 rounded-3xl"><p className="text-[10px] font-black text-slate-400 mb-2">SỐ CŨ</p><p className="text-3xl font-black text-slate-500">{reading.prevElectricity}</p></div>
                 <div className="flex-1 bg-blue-50 p-6 rounded-3xl border border-blue-100"><p className="text-[10px] font-black text-blue-400 mb-2">NHẬP SỐ MỚI</p><input type="number" value={reading.currElectricity} onChange={(e) => updateReading(room.id, 'currElectricity', Number(e.target.value))} className="w-full text-4xl font-black text-blue-600 outline-none bg-transparent" /></div></div>
              </div>
              <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-xl">
                 <div className="flex justify-between items-center mb-6"><label className="text-[11px] font-black text-slate-500 uppercase tracking-widest">💧 Nước (m³)</label></div>
                 <div className="flex gap-4"><div className="flex-1 bg-slate-50 p-6 rounded-3xl"><p className="text-[10px] font-black text-slate-400 mb-2">SỐ CŨ</p><p className="text-3xl font-black text-slate-500">{reading.prevWater}</p></div>
                 <div className="flex-1 bg-indigo-50 p-6 rounded-3xl border border-indigo-100"><p className="text-[10px] font-black text-indigo-400 mb-2">NHẬP SỐ MỚI</p><input type="number" value={reading.currWater} onChange={(e) => updateReading(room.id, 'currWater', Number(e.target.value))} className="w-full text-4xl font-black text-indigo-600 outline-none bg-transparent" /></div></div>
              </div>
           </div>
           <div className="bg-white p-8 rounded-[3rem] shadow-2xl border border-slate-100 space-y-6">
              <h3 className="font-black text-slate-900 text-xl flex items-center gap-3 italic">💳 Thanh toán & Gửi UNC</h3>
              <div className="flex flex-col md:flex-row gap-6 items-center bg-slate-50 p-6 rounded-[2.5rem] border border-slate-200">
                 {paymentQrCode ? <img src={paymentQrCode} alt="QR" className="w-40 h-40 rounded-3xl shadow-lg border-4 border-white" /> : <div className="w-40 h-40 bg-slate-200 rounded-3xl flex items-center justify-center text-slate-400 text-xs italic text-center p-4">Chủ nhà chưa cung cấp QR</div>}
                 <div className="flex-1 space-y-2 text-center md:text-left"><p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Nội dung chuyển khoản</p><p className="text-slate-800 font-bold text-sm bg-white p-3 rounded-xl border border-slate-100 shadow-sm">{paymentDescription}</p></div>
              </div>
              <div className="pt-4 border-t border-slate-100">
                 <label className="cursor-pointer bg-slate-100 hover:bg-blue-50 border-2 border-dashed border-slate-300 rounded-[2rem] p-8 flex flex-col items-center gap-3 transition-all group">
                    <span className="text-3xl group-hover:scale-110 transition-transform">📸</span>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">Tải lên ảnh UNC thanh toán</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleReceiptUpload(room.id, e)} />
                 </label>
                 {reading.receiptImage && <div className="bg-green-50 p-4 rounded-xl mt-4 flex items-center justify-between border border-green-200 animate-in fade-in duration-300"><div className="flex items-center gap-2"><span className="text-xl">✅</span><p className="text-[10px] font-black text-green-700 uppercase">ĐÃ GỬI MINH CHỨNG</p></div><button onClick={() => updateReading(room.id, 'receiptImage', undefined)} className="text-[8px] font-black text-rose-600 uppercase underline">Hủy gửi</button></div>}
              </div>
           </div>
        </main>
      </div>
    );
  };

  if (viewMode === 'admin') return renderAdminView();
  if (viewMode === 'tenant') return renderTenantView();
  return renderLandingPage();
};

export default App;

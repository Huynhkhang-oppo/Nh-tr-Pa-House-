
import { Room } from './types';

export const DEFAULT_ROOMS: Room[] = Array.from({ length: 8 }, (_, i) => ({
  id: `room-${i + 1}`,
  name: `Phòng ${i + 1}`,
  baseRent: 3500000, // 3.5M VND
  electricityRate: 3500, // 3.5k per kWh
  waterRate: 25000, // 25k per m3
  serviceFee: 150000, // Internet + Trash
  pin: '1234', // Mật khẩu mặc định
}));

export const CURRENCY_FORMATTER = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
});

export const MONTHS = [
  '01', '02', '03', '04', '05', '06', 
  '07', '08', '09', '10', '11', '12'
];

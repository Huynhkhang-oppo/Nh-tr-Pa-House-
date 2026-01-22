
export interface Room {
  id: string;
  name: string;
  baseRent: number;
  electricityRate: number;
  waterRate: number;
  serviceFee: number; // Internet, Trash, etc.
  pin: string; // Mật khẩu truy cập riêng của phòng
}

export interface Reading {
  roomId: string;
  month: string; // YYYY-MM
  prevElectricity: number;
  currElectricity: number;
  prevWater: number;
  currWater: number;
  otherFees: number;
  paid: boolean;
  receiptImage?: string; // Ảnh chụp màn hình chuyển khoản (UNC)
}

export interface MonthlySummary {
  totalRevenue: number;
  totalElectricity: number;
  totalWater: number;
  paidCount: number;
  unpaidCount: number;
}

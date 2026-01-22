
import { GoogleGenAI } from "@google/genai";
import { Room, Reading } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function analyzeRentalData(rooms: Room[], readings: Reading[], month: string) {
  const currentMonthReadings = readings.filter(r => r.month === month);
  
  const prompt = `
    Dưới đây là dữ liệu quản lý phòng trọ cho tháng ${month}:
    Cấu hình phòng: ${JSON.stringify(rooms)}
    Chỉ số điện nước: ${JSON.stringify(currentMonthReadings)}

    Hãy phân tích và đưa ra:
    1. Tổng quan doanh thu dự kiến.
    2. Các phòng có mức tiêu thụ điện/nước bất thường (cao hơn trung bình).
    3. Đề xuất thông báo nhắc nhở đóng tiền chuyên nghiệp bằng tiếng Việt cho chủ nhà gửi cho khách.
    4. Gợi ý tối ưu chi phí vận hành.

    Trả về phản hồi bằng Markdown dễ đọc, trình bày đẹp mắt.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("AI Analysis Error:", error);
    return "Không thể phân tích dữ liệu bằng AI lúc này. Vui lòng thử lại sau.";
  }
}

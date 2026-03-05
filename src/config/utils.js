// Hàm chia nhỏ mảng thành các phần nhỏ hơn (ví dụ mỗi phần 100 phần tử)
export const chunkArray = (array, size) => {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
};


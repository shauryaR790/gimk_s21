export function readFile(file: File, allowDocument = false) {
  return new Promise<string>((resolve, reject) => {
    const pdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (pdf) {
      if (!allowDocument) {
        reject(new Error('Use a JPG or PNG photo.'));
        return;
      }
      if (file.size > 1_000_000) {
        reject(new Error('Keep the file under 1 MB.'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsDataURL(file);
      return;
    }
    if (!file.type.startsWith('image/')) {
      reject(new Error(allowDocument ? 'Use a photo or PDF.' : 'Use a JPG or PNG photo.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const raw = String(reader.result ?? '');
      if (raw.length <= 1_400_000) {
        resolve(raw);
        return;
      }
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not compress the photo.'));
          return;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      };
      image.onerror = () => reject(new Error('Could not read that photo.'));
      image.src = raw;
    };
    reader.readAsDataURL(file);
  });
}

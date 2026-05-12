import { Router, Response, Request } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { supabase } from '../utils/supabase';

interface AuthRequest extends Request {
  user?: any;
  file?: Express.Multer.File;
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  console.log('Upload request received. File in req:', !!req.file);
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { originalname, mimetype, buffer } = req.file;
    console.log(`Uploading file: ${originalname} (${mimetype}, ${buffer.length} bytes)`);
    const ext = originalname.split('.').pop();
    const fileName = `${Math.random().toString(36).slice(2)}_${Date.now()}.${ext}`;
    const filePath = `attachments/${fileName}`;

    console.log(`Target path: ${filePath}`);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(filePath, buffer, { 
        contentType: mimetype, 
        upsert: false 
      });

    if (uploadError) {
      console.error('Supabase Storage Error Details:', {
        message: uploadError.message,
        error: uploadError
      });
      throw uploadError;
    }

    console.log('Upload successful in storage:', uploadData);

    const { data: publicData } = supabase.storage
      .from('attachments')
      .getPublicUrl(filePath);

    if (!publicData?.publicUrl) {
      console.error('Failed to get public URL for:', filePath);
      throw new Error('Failed to generate public URL');
    }

    console.log('Generated public URL:', publicData.publicUrl);

    return res.json({
      file_name: originalname,
      file_url: publicData.publicUrl,
      attachment_type: mimetype,
      attachment_scope: 'request'
    });
  } catch (err: any) {
    console.error('CRITICAL Upload error:', err);
    return res.status(500).json({ 
      error: err.message || 'Upload failed',
      details: err
    });
  }
});

export default router;

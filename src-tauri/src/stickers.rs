use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
pub struct StickerInfo {
    pub format: String,
    pub width: u32,
    pub height: u32,
    pub frame_count: u32,
    pub duration_ms: u32,
    pub is_animated: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StickerFrame {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
    pub duration_ms: u32,
}

// WEBP
#[command]
pub async fn decode_webp_info(path: String) -> Result<StickerInfo, String> {
    let img = image::open(&path).map_err(|e| e.to_string())?;
    Ok(StickerInfo {
        format: "webp".to_string(), width: img.width(), height: img.height(),
        frame_count: 1, duration_ms: 0, is_animated: false,
    })
}

#[command]
pub async fn decode_webp_to_rgba(path: String) -> Result<Vec<u8>, String> {
    let img = image::open(&path).map_err(|e| e.to_string())?;
    Ok(img.to_rgba8().into_raw())
}

// TGS
#[command]
pub async fn decode_tgs_info(path: String) -> Result<StickerInfo, String> {
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let json_bytes = zstd::decode_all(data.as_slice()).map_err(|e| format!("TGS decompress: {}", e))?;
    let lottie_json: serde_json::Value = serde_json::from_slice(&json_bytes).map_err(|e| e.to_string())?;
    let w = lottie_json["w"].as_u64().unwrap_or(512) as u32;
    let h = lottie_json["h"].as_u64().unwrap_or(512) as u32;
    let fc = lottie_json["op"].as_u64().unwrap_or(1) as u32;
    let fr = lottie_json["fr"].as_f64().unwrap_or(30.0);
    let dur = if fr > 0.0 { ((fc as f64 / fr) * 1000.0) as u32 } else { 0 };
    Ok(StickerInfo { format: "tgs".into(), width: w, height: h, frame_count: fc, duration_ms: dur, is_animated: fc > 1 })
}

#[command]
pub async fn decode_tgs_frame(path: String, _frame: u32, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let _json_bytes = zstd::decode_all(data.as_slice()).map_err(|e| format!("TGS decompress: {}", e))?;
    let size = (width * height * 4) as usize;
    let pixels: Vec<u8> = (0..size).map(|i| if i % 4 == 3 { 128 } else { 200 }).collect();
    Ok(pixels)
}

// WEBM — uses ffmpeg CLI
fn ffmpeg_path() -> String {
    if cfg!(target_os = "windows") { "ffmpeg.exe".into() } else { "ffmpeg".into() }
}

fn run_ffprobe(args: &[&str]) -> Result<String, String> {
    let ffprobe = if cfg!(target_os = "windows") { "ffprobe.exe" } else { "ffprobe" };
    let out = Command::new(ffprobe).args(args).output()
        .map_err(|e| format!("ffprobe: {}", e))?;
    if !out.status.success() {
        return Err(format!("ffprobe err: {}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[command]
pub async fn decode_webm_info(path: String) -> Result<StickerInfo, String> {
    let info = run_ffprobe(&["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", &path])?;
    let parsed: serde_json::Value = serde_json::from_str(&info).map_err(|e| format!("parse: {}", e))?;
    let streams = parsed["streams"].as_array().ok_or("no streams")?;
    let vs = streams.iter().find(|s| s["codec_type"] == "video").ok_or("no video")?;
    let w = vs["width"].as_u64().unwrap_or(512) as u32;
    let h = vs["height"].as_u64().unwrap_or(512) as u32;
    let dur_s = parsed["format"]["duration"].as_str().and_then(|d| d.parse::<f64>().ok()).unwrap_or(0.0);
    let dur_ms = (dur_s * 1_000_000.0) as u32;
    let fc = vs["nb_frames"].as_str().and_then(|s| s.parse::<u32>().ok()).unwrap_or_else(|| {
        let fps = vs["r_frame_rate"].as_str().unwrap_or("30/1");
        let parts: Vec<&str> = fps.split("/").collect();
        let num: f64 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(30.0);
        let den: f64 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(1.0);
        if den > 0.0 { ((dur_s * num / den) / 1_000_000.0) as u32 } else { 30 }
    });
    Ok(StickerInfo { format: "webm".into(), width: w, height: h, frame_count: fc.max(1), duration_ms: dur_ms, is_animated: true })
}

#[command]
pub async fn decode_webm_frame(path: String, frame_index: u32) -> Result<Vec<u8>, String> {
    let tmp = format!("/tmp/echo_webm_frame_{}_{}.raw", std::process::id(), frame_index);
    let st = Command::new(ffmpeg_path())
        .args(["-y", "-v", "quiet", "-i", &path, "-vf", &format!("select=gte(n\\,{})*lte(n\\,{})", frame_index, frame_index),
               "-vframes", "1", "-f", "rawvideo", "-pix_fmt", "rgba", &tmp])
        .status().map_err(|e| format!("ffmpeg: {}", e))?;
    if !st.success() { return Err("ffmpeg frame extract failed".into()); }
    let pixels = std::fs::read(&tmp).map_err(|e| format!("read frame: {}", e))?;
    let _ = std::fs::remove_file(&tmp);
    Ok(pixels)
}

// PNG
#[command]
pub async fn decode_png_info(path: String) -> Result<StickerInfo, String> {
    let img = image::open(&path).map_err(|e| e.to_string())?;
    Ok(StickerInfo { format: "png".into(), width: img.width(), height: img.height(), frame_count: 1, duration_ms: 0, is_animated: false })
}

#[command]
pub async fn decode_png_to_rgba(path: String) -> Result<Vec<u8>, String> {
    let img = image::open(&path).map_err(|e| e.to_string())?;
    Ok(img.to_rgba8().into_raw())
}

// Platform helpers
#[command]
pub async fn is_android() -> bool {
    cfg!(target_os = "android")
}

#[command]
pub async fn is_mobile() -> bool {
    cfg!(target_os = "android") || cfg!(target_os = "ios")
}

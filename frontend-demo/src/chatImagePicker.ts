/**
 * 从相册选图或拍照，并压缩成适合发给后端的大小（长边 1280、JPEG）。
 * Android 13 起走系统的照片选择器，不需要相册权限；只读用户点选的那几张。
 */
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

import { FALLBACK_SIDE, MAX_IMAGE_BYTES, MAX_SIDE, base64Bytes, fitWithin, type PickedImage } from "./chatImages";

async function shrink(uri: string, w: number, h: number, side: number, compress: number): Promise<PickedImage | null> {
  const size = fitWithin(w, h, side);
  const out = await manipulateAsync(uri, size ? [{ resize: size }] : [], {
    compress,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!out.base64 || base64Bytes(out.base64) > MAX_IMAGE_BYTES) return null;
  return { uri: out.uri, data: out.base64, mime: "image/jpeg" };
}

function toPicked(assets: ImagePicker.ImagePickerAsset[], remaining: number) {
  return (async () => {
    const picked: PickedImage[] = [];
    for (const asset of assets.slice(0, remaining)) {
      const image =
        (await shrink(asset.uri, asset.width, asset.height, MAX_SIDE, 0.72)) ??
        (await shrink(asset.uri, asset.width, asset.height, FALLBACK_SIDE, 0.5));
      if (!image) throw new Error("这张图片太大了，换一张试试");
      picked.push(image);
    }
    return picked;
  })();
}

/** 拍一张照。没给相机权限 / 取消 → 抛错或返回空数组；message 可直接给用户看。 */
export async function takeChatPhoto(): Promise<PickedImage[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error("没有相机权限，可以在系统设置里给喵灵打开");
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1, exif: false });
  if (res.canceled) return [];
  return toPicked(res.assets, 1);
}

/**
 * 让用户选最多 remaining 张图。取消返回空数组；有图片压完还是太大就抛错（message 可直接给用户看）。
 */
export async function pickChatImages(remaining: number): Promise<PickedImage[]> {
  if (remaining <= 0) return [];
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: remaining > 1,
    selectionLimit: remaining,
    quality: 1,
    exif: false,
  });
  if (res.canceled) return [];
  return toPicked(res.assets, remaining);
}

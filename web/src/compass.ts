export function compassHeading(yaw: number) {
  const degrees = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
  return { degrees, label: ['北', '东北', '东', '东南', '南', '西南', '西', '西北'][Math.round(degrees / 45) % 8] };
}

// Identifica al visitante por su IP, para los límites de intentos.

// Una red IPv6 tiene millones de direcciones (todo un /64 suele ser de una
// sola casa), así que se cuenta por red y no por dirección.
export function claveIp(ip = "") {
  if (ip.startsWith("::ffff:")) return ip.slice(7); // IPv4 escrita como IPv6
  if (!ip.includes(":")) return ip;
  const partes = ip.split("::");
  const izq = partes[0] ? partes[0].split(":") : [];
  const der = partes[1] ? partes[1].split(":") : [];
  const completa = partes.length === 2
    ? [...izq, ...Array(8 - izq.length - der.length).fill("0"), ...der]
    : izq;
  return completa.slice(0, 4).join(":") + "::/64";
}

import logo from "../../imports/image.png";

export function HiLogo({ className = "size-7" }: { className?: string }) {
  return <img src={logo} alt="HackIllinois" className={`${className} object-contain`} />;
}

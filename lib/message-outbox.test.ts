import { afterEach, describe, expect, it, vi } from "@/lib/test-runtime";
import { renderCommerceSms, sendMobiWaveSms, stableSmsProviderKey } from "@/lib/message-outbox";

describe("transactional commerce SMS templates", () => {
  it("renders order received details without trusting HTML", () => {
    const message=renderCommerceSms("order_received",{storeName:"Kilifi Store",customerName:"Amina",orderNumber:"MW-1001",totalMinor:125050,currency:"KES"});
    expect(message).toContain("Amina"); expect(message).toContain("MW-1001"); expect(message).toContain("KES 1,250.5");
  });
  it("warns customers not to pay again while a payment is uncertain", () => {
    const message=renderCommerceSms("order_payment_failed",{storeName:"Test Store",customerName:"Amina",orderNumber:"MW-1002"});
    expect(message).toContain("If you were charged"); expect(message).toContain("before paying again");
  });
});
describe("SMS idempotency", () => {
  it("derives a stable opaque provider key per store and event", () => {
    const key=stableSmsProviderKey("store-1","order-paid-1");
    expect(key).toBe(stableSmsProviderKey("store-1","order-paid-1"));
    expect(key).not.toBe(stableSmsProviderKey("store-2","order-paid-1"));
    expect(key).toMatch(/^[a-f0-9]{64}$/);
  });
});
describe("MobiWave v3 SMS adapter", () => {
  afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
  const configure=()=>{vi.stubEnv("MOBIWAVE_SMS_API_URL","https://sms.mobiwave.co.ke/api/v3");vi.stubEnv("MOBIWAVE_SMS_API_KEY","test-api-token");vi.stubEnv("MOBIWAVE_SMS_SENDER_ID","MOBIWAVE");};
  it("sends the request with a stable provider idempotency key",async()=>{
    configure();
    const fetchMock=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({status:"success",data:{uid:"sms_123"}}),{status:200,headers:{"Content-Type":"application/json"}}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(sendMobiWaveSms("254700000000","Order received","stable-key")).resolves.toBe("sms_123");
    const [url,init]=fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://sms.mobiwave.co.ke/api/v3/sms/send");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("stable-key");
    expect(JSON.parse(String(init?.body))).toEqual({recipient:"254700000000",sender_id:"MOBIWAVE",type:"plain",message:"Order received"});
  });
  it("treats HTTP 429 as retryable and honours Retry-After",async()=>{
    configure(); vi.stubGlobal("fetch",vi.fn<typeof fetch>(async()=>new Response("",{status:429,headers:{"Retry-After":"45"}})));
    await expect(sendMobiWaveSms("254700000000","Hello","key")).rejects.toMatchObject({kind:"retryable_rejection",code:"sms_provider_rate_limited",retryAfterSeconds:45});
  });
  it("treats HTTP 5xx as ambiguous, never as a safe retry",async()=>{
    configure(); vi.stubGlobal("fetch",vi.fn<typeof fetch>(async()=>new Response("",{status:503})));
    await expect(sendMobiWaveSms("254700000000","Hello","key")).rejects.toMatchObject({kind:"ambiguous",code:"sms_provider_http_503_outcome_unknown"});
  });
  it("treats network timeouts as ambiguous",async()=>{
    configure(); vi.stubGlobal("fetch",vi.fn<typeof fetch>(async()=>{throw new Error("socket timeout");}));
    await expect(sendMobiWaveSms("254700000000","Hello","key")).rejects.toMatchObject({kind:"ambiguous",code:"sms_provider_network_outcome_unknown"});
  });
  it("treats explicit 4xx rejection as permanent",async()=>{
    configure(); vi.stubGlobal("fetch",vi.fn<typeof fetch>(async()=>new Response("",{status:400})));
    await expect(sendMobiWaveSms("254700000000","Hello","key")).rejects.toMatchObject({kind:"permanent_rejection",code:"sms_provider_http_400"});
  });
  it("rejects invalid sender ID before sending",async()=>{
    vi.stubEnv("MOBIWAVE_SMS_API_KEY","test-api-token"); vi.stubEnv("MOBIWAVE_SMS_SENDER_ID","MOBIWAVE-STORE");
    const fetchMock=vi.fn(); vi.stubGlobal("fetch",fetchMock);
    await expect(sendMobiWaveSms("254700000000","Hello","key")).rejects.toThrow("sms_sender_id_too_long");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

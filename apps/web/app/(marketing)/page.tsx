import type { Metadata } from 'next';
import Link from 'next/link';
import { Riyal } from '@/components/Riyal';

export const metadata: Metadata = {
  title: { absolute: 'أرسو · نرسي نمو متجرك' },
  description:
    'اربط متجرك وإعلاناتك وتكاليفك في مكان واحد. اعرف ما يبقى لك فعلًا من كل طلب، واكتشف أين تخسر، ونفّذ القرار الذي يصنع الفرق.',
};

const STEPS = [
  { title: 'اربط', body: 'متجرك على سلة وحساباتك الإعلانية في دقائق، أو ارفع ملفاتك.' },
  { title: 'أكمل', body: 'تكاليف منتجاتك والشحن والدفع. وأرسو يخبرك بما ينقص وأثره.' },
  { title: 'افهم', body: 'ما حدث فعلًا في متجرك، بجانب ما تدّعيه كل منصة إعلانية.' },
  { title: 'قرّر', body: 'من بين أهم ثلاث فرص، مرتبة حسب الأثر وقوة الدليل.' },
  { title: 'نفّذ', body: 'بمهمة أو تجربة لها مسؤول وموعد ومؤشر نجاح واحد.' },
  { title: 'تعلّم', body: 'نتيجة كل قرار تُحفظ في ذاكرة متجرك للقرار التالي.' },
];

type Status = 'live' | 'building';
const FEATURES: { title: string; body: string; status: Status }[] = [
  {
    title: 'الفريق والصلاحيات',
    body: 'لكل عضو دوره والمتاجر التي يراها. المصمم لا يرى أرقامك المالية، والوكالة ترى ما تمنحه لها فقط، والسحب فوري.',
    status: 'live',
  },
  {
    title: 'صفحة الحقيقة',
    body: 'صافي المبيعات والإنفاق وما يبقى لك بعد التكاليف. لكل رقم مصدره ووقت تحديثه، والرقم الناقص يظهر ناقصًا.',
    status: 'building',
  },
  {
    title: 'اقتصاد الطلب',
    body: 'يتتبع كل ريال في الطلب: البضاعة والشحن والدفع والتغليف والمرتجع والإعلان، حتى نهاية دورة الطلب.',
    status: 'building',
  },
  {
    title: 'ما تدّعيه المنصات مقابل الحقيقة',
    body: 'لا يجمع تحويلات سناب وميتا وتيك توك كأنها طلبات منفصلة؛ يضعها بجانب مبيعات متجرك الحقيقية.',
    status: 'building',
  },
  {
    title: 'أهم ثلاث فرص',
    body: 'بدل مئة تنبيه، ثلاث فرص بالدليل. كل فرصة تفصل الحقيقة عن الفرضية، وتقترح الفحص قبل القرار.',
    status: 'building',
  },
  {
    title: 'التجارب وذاكرة التعلم',
    body: 'اختبر قبل أن تعمّم، واقرأ النتيجة بعد اكتمال الطلبات. «غير حاسمة» ليست فشلًا، بل معرفة.',
    status: 'building',
  },
];

const FAQ = [
  {
    q: 'هل يعمل أرسو مع متجري؟',
    a: 'نبدأ بمتاجر سلة، ويمكن رفع البيانات بملفات للمنصات غير المدعومة بعد.',
  },
  {
    q: 'ما الفرق بين أرسو ولوحة متجري؟',
    a: 'لوحة المتجر تعرض المبيعات. أرسو يحسب ما يبقى لك بعد التكاليف والإعلان، ويضع ادعاءات المنصات بجانب الحقيقة، ويحوّل ما يكتشفه إلى قرارات تُقاس.',
  },
  {
    q: 'لا أعرف تكاليف كل منتجاتي. هل أستفيد؟',
    a: 'نعم. ترى المبيعات والإنفاق فورًا، وأرسو يحدد التكاليف الناقصة ويساعدك على إكمالها، ولن يعرض ربحًا محسوبًا على تكاليف صفرية.',
  },
  {
    q: 'هل يغيّر أرسو حملاتي بدون علمي؟',
    a: 'أبدًا. الإصدار الأول للقراءة والتحليل فقط، وأي تنفيذ لاحقًا يحتاج معاينة واعتمادًا صريحًا منك ضمن سقوف تحددها.',
  },
  {
    q: 'هل بياناتي آمنة؟',
    a: 'كل مؤسسة معزولة تمامًا داخل قاعدة البيانات نفسها، والمفاتيح مشفرة، وكل وصول حساس مسجل، ولا نشارك بيانات متجرك مع أي متجر آخر.',
  },
];

function Badge({ status }: { status: Status }) {
  return status === 'live' ? (
    <span className="badge badge-ok">
      <span aria-hidden="true">✓</span> متاح
    </span>
  ) : (
    <span className="badge badge-missing">
      <span aria-hidden="true">◔</span> قيد البناء
    </span>
  );
}

export default function HomePage() {
  return (
    <>
      {/* ===== البطل ===== */}
      <section className="mk-hero">
        <svg className="mk-waves" viewBox="0 0 600 260" fill="none" aria-hidden="true">
          <g stroke="#BFC3C8" strokeWidth="1" opacity=".35">
            <path d="M0 230 C140 230 180 70 320 70 S510 140 600 50" />
            <path d="M0 242 C140 242 186 86 326 86 S510 156 600 66" />
            <path d="M0 254 C140 254 192 102 332 102 S510 172 600 82" />
          </g>
          <path
            d="M0 218 C140 218 174 54 314 54 S510 124 600 34"
            stroke="#C6A76A"
            strokeWidth="1.3"
          />
        </svg>
        <div className="mk-wrap mk-hero-inner">
          <div className="mk-hero-copy">
            <p className="mk-eyebrow">منصة ربحية المتاجر الإلكترونية</p>
            <h1>نرسي نمو متجرك</h1>
            <p className="mk-hero-lead">
              اربط متجرك وإعلاناتك وتكاليفك في مكان واحد. اعرف ما يبقى لك فعلًا من كل طلب، واكتشف
              أين تخسر، ونفّذ القرار الذي يصنع الفرق.
            </p>
            <div className="mk-cta">
              <Link href="/sign-up" className="btn btn-accent mk-btn-lg">
                ابدأ تشخيص متجرك
              </Link>
              <a href="#how" className="btn mk-btn-ghost-dark mk-btn-lg">
                كيف يعمل
              </a>
            </div>
            <p className="mk-hero-note">بلا بطاقة ائتمان. ولن نعرض أي رقم قبل أن يكون له مصدر.</p>
          </div>

          <div className="mk-hero-card" aria-label="مثال توضيحي لبطاقات أرسو">
            <span className="mk-sample">مثال توضيحي</span>
            <div className="mk-mini">
              <span className="mk-mini-label">صافي مبيعات المنتجات</span>
              <span className="mk-mini-value">
                <span className="num">84,320.50</span>
                <Riyal />
              </span>
              <span className="mk-mini-ok">✓ مكتمل · سلة</span>
            </div>
            <div className="mk-mini">
              <span className="mk-mini-label">المساهمة بعد التسويق</span>
              <span className="mk-mini-value mk-mini-missing">الربحية غير مكتملة</span>
              <span className="mk-mini-warn">◐ تكلفة 8 منتجات مفقودة</span>
            </div>
            <div className="mk-mini mk-mini-opp">
              <span className="mk-mini-label">فرصة · أولوية عالية</span>
              <span className="mk-mini-title">حملة تقود إلى مقاس نفد</span>
              <span className="mk-mini-fact">41٪ من زيارات الحملة تصل إلى متغير غير متوفر</span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== المشكلة ===== */}
      <section className="mk-section">
        <div className="mk-wrap mk-split">
          <div>
            <h2 className="mk-h2">مبيعاتك ترتفع. هل أرباحك كذلك؟</h2>
            <p className="mk-lead">
              كل منصة إعلانية تنسب البيعة لنفسها، ولوحة متجرك لا تعرف كم كلّفك الطلب فعلًا. النتيجة:
              قرارات بميزانيات حقيقية على أرقام ناقصة. أرسو يضع كل شيء في معادلة واحدة صادقة.
            </p>
          </div>
          <div className="mk-claims" aria-label="ثلاث منصات تدعي نفس الطلب">
            <div className="mk-claim">
              <span>سناب</span>
              <b>«أنا جلبته»</b>
            </div>
            <div className="mk-claim">
              <span>تيك توك</span>
              <b>«بل أنا»</b>
            </div>
            <div className="mk-claim">
              <span>ميتا</span>
              <b>«أنا»</b>
            </div>
            <div className="mk-claim mk-claim-truth">
              <span>متجرك</span>
              <b>طلب واحد</b>
            </div>
          </div>
        </div>
      </section>

      {/* ===== القيمة ===== */}
      <section className="mk-section mk-section-alt" id="why">
        <div className="mk-wrap">
          <h2 className="mk-h2 mk-center">من الأرقام إلى القرار</h2>
          <div className="mk-grid-3">
            <article className="mk-card">
              <span className="mk-num">01</span>
              <h3>افهم أرقامك</h3>
              <p>
                مبيعات، وإعلانات، وتكاليف، ومرتجعات، في لوحة واحدة تقول لك ما يبقى لك فعلًا. ولكل
                رقم مصدر وتعريف.
              </p>
            </article>
            <article className="mk-card">
              <span className="mk-num">02</span>
              <h3>اكتشف فرصك</h3>
              <p>أهم ثلاث فرص أمامك، مرتبة حسب الأثر وقوة الدليل. لا ضجيج، ولا مئة تنبيه.</p>
            </article>
            <article className="mk-card">
              <span className="mk-num">03</span>
              <h3>نفّذ وقِس الأثر</h3>
              <p>
                حوّل كل فرصة إلى خطوة أو تجربة، واقرأ نتيجتها الحقيقية بعد اكتمال الطلبات
                والمرتجعات.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* ===== كيف يعمل ===== */}
      <section className="mk-section" id="how">
        <div className="mk-wrap">
          <h2 className="mk-h2 mk-center">من الفكرة إلى الأثر، في دورة واحدة</h2>
          <ol className="mk-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="mk-step-n num">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ===== مثال الربحية ===== */}
      <section className="mk-section mk-section-dark">
        <div className="mk-wrap mk-split">
          <div>
            <h2 className="mk-h2">المساهمة، لا المبيعات</h2>
            <p className="mk-lead mk-lead-dark">
              طلب بـ 200 ريال قد يترك لك 60، وقد يكلفك 20 إن عادت قطعة. أرسو يحسب كل طلب حتى نهايته.
            </p>
          </div>
          <div className="mk-ledger" aria-label="مثال حسابي لطلب واحد">
            <span className="mk-sample mk-sample-dark">مثال حسابي</span>
            {[
              ['صافي المنتجات', '200.00'],
              ['شحن محصّل', '10.00'],
              ['تكلفة البضاعة', '-80.00'],
              ['شحن الناقل', '-25.00'],
              ['رسوم الدفع', '-6.00'],
              ['التغليف', '-4.00'],
              ['الإعلان', '-35.00'],
            ].map(([k, v]) => (
              <div className="mk-ledger-row" key={k}>
                <span>{k}</span>
                <span className="num">{v}</span>
              </div>
            ))}
            <div className="mk-ledger-row mk-ledger-total">
              <span>يبقى لك</span>
              <span className="num">
                60.00 <Riyal />
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== القدرات ===== */}
      <section className="mk-section">
        <div className="mk-wrap">
          <h2 className="mk-h2 mk-center">ما يقدمه أرسو</h2>
          <p className="mk-lead mk-center">
            نبني أرسو على مراحل، ونقول لك بوضوح ما المتاح الآن وما قيد البناء.
          </p>
          <div className="mk-grid-3">
            {FEATURES.map((f) => (
              <article className="mk-card" key={f.title}>
                <Badge status={f.status} />
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== الثقة ===== */}
      <section className="mk-section mk-section-alt">
        <div className="mk-wrap mk-split">
          <div>
            <h2 className="mk-h2">بياناتك لك وحدك</h2>
            <p className="mk-lead">
              عزل كامل بين المؤسسات داخل قاعدة البيانات نفسها، وتشفير للمفاتيح، وسجل لكل وصول حساس،
              وصلاحيات دقيقة لكل عضو في فريقك. ولا يُنفَّذ أي إجراء مالي دون اعتمادك.
            </p>
          </div>
          <ul className="mk-checks">
            <li>لا نشارك بيانات متجرك مع أي متجر آخر</li>
            <li>الذكاء الاصطناعي يشرح ويقترح، ولا يحسب الأرقام ولا يعتمد إنفاقًا</li>
            <li>الرقم الناقص يظهر ناقصًا، لا صفرًا</li>
            <li>كل تعديل في الصلاحيات مسجّل قبله وبعده</li>
          </ul>
        </div>
      </section>

      {/* ===== الأسئلة ===== */}
      <section className="mk-section" id="faq">
        <div className="mk-wrap mk-faq-wrap">
          <h2 className="mk-h2 mk-center">أسئلة شائعة</h2>
          <div className="mk-faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ===== الدعوة الختامية ===== */}
      <section className="mk-final">
        <div className="mk-wrap mk-center">
          <h2 className="mk-h2">متجرك يستحق قرارات أوضح</h2>
          <p className="mk-lead mk-lead-dark mk-center">
            ابدأ بتشخيص متجرك، وشاهد ما تقوله أرقامك الحقيقية.
          </p>
          <Link href="/sign-up" className="btn btn-accent mk-btn-lg">
            ابدأ تشخيص متجرك
          </Link>
        </div>
      </section>
    </>
  );
}

/**
 * 专利技术方案三方评估系统
 * 数据层：Bmob 后端云（国内直连，无需翻墙）
 * 业务层：v2.0 完整功能
 */

// ==================== 常量配置 ====================
const CONFIG = {
    DB_KEY: 'patent_eval_db_v2',
    BACKUP_KEY: 'patent_eval_backup',
    USER_KEY: 'currentUser',
    INVITE_CODE: (typeof BMOB_CONFIG !== 'undefined') ? BMOB_CONFIG.INVITE_CODE : '5201314',
    MAX_IMAGES: 5,
    MAX_IMAGE_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    VERSION: '2.0'
};

// 部门配置
const DEPT_CONFIG = {
    market: { name: '市场端', icon: '🏢', color: '#e74c3c', weight: 0.4 },
    tech:   { name: '研发端', icon: '🔬', color: '#3498db', weight: 0.4 },
    patent: { name: '专利端', icon: '⚖️', color: '#9b59b6', weight: 0.2 }
};

// 评分等级配置（基于百分制）
const LEVEL_CONFIG = [
    { min: 90, title: '极具价值', class: 'level-excellent' },
    { min: 80, title: '高价值',   class: 'level-good'      },
    { min: 70, title: '中等偏上价值', class: 'level-average' },
    { min: 60, title: '中等价值', class: 'level-caution'   },
    { min: 0,  title: '低价值',   class: 'level-poor'      }
];

// ==================== Bmob 后端云初始化 ====================
let bmobReady = false;

// Bmob API 请求封装
const BmobAPI = {
    headers: {
        'X-Bmob-Application-Id': '',
        'X-Bmob-REST-API-Key': '',
        'Content-Type': 'application/json'
    },

    init() {
        if (typeof BMOB_CONFIG === 'undefined') return false;
        this.headers['X-Bmob-Application-Id'] = BMOB_CONFIG.APPLICATION_ID;
        this.headers['X-Bmob-REST-API-Key'] = BMOB_CONFIG.REST_API_KEY;
        return true;
    },

    async get(table, where = {}, order = '-createdAt', limit = 200) {
        let url = `https://api.bmobapp.com/1/classes/${table}?limit=${limit}&order=${order}`;
        if (Object.keys(where).length > 0) {
            url += `&where=${encodeURIComponent(JSON.stringify(where))}`;
        }
        const res = await fetch(url, { headers: this.headers });
        return await res.json();
    },

    async post(table, data) {
        const res = await fetch(`https://api.bmobapp.com/1/classes/${table}`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify(data)
        });
        return await res.json();
    },

    async put(table, objectId, data) {
        const res = await fetch(`https://api.bmobapp.com/1/classes/${table}/${objectId}`, {
            method: 'PUT',
            headers: this.headers,
            body: JSON.stringify(data)
        });
        return await res.json();
    },

    async delete(table, objectId) {
        const res = await fetch(`https://api.bmobapp.com/1/classes/${table}/${objectId}`, {
            method: 'DELETE',
            headers: this.headers
        });
        return res.ok;
    }
};

function initBmob() {
    console.log('=== 开始初始化 Bmob ===');

    if (typeof BMOB_CONFIG === 'undefined' ||
        !BMOB_CONFIG.APPLICATION_ID || 
        BMOB_CONFIG.APPLICATION_ID === '你的_Application_ID') {
        console.error('❌ BMOB_CONFIG 未配置，请先配置 config.js');
        _updateStatusText(false, '未配置');
        return false;
    }

    try {
        BmobAPI.init();
        bmobReady = true;
        console.log('✅ Bmob 初始化成功');
        _updateStatusText(true);
        return true;
    } catch (e) {
        console.error('❌ Bmob 初始化失败:', e);
        _updateStatusText(false, e.message);
        return false;
    }
}

function _updateStatusText(ok) {
    const el = document.getElementById('dataStatusText');
    if (!el) return;
    el.innerHTML = ok
        ? '<strong style="color:#27ae60;">✅ 云端模式：</strong>数据同步至 Bmob，支持多人实时协作！'
        : '<strong style="color:#e74c3c;">⚠️ 本地模式：</strong>云端连接失败，数据仅保存在本机，无法多人协作。';
}

function isCloudMode() { return bmobReady && bmobDB !== null; }

// ==================== 云端缓存 ====================
let cloudCache = { projects: [], evaluations: [] };
let lastSyncTime = 0;
// 轮询定时器（每 30 秒自动同步一次，支持多人协作）
let pollTimer = null;

async function syncFromCloud() {
    if (!isCloudMode()) return false;
    console.log('🔄 从 Bmob 同步数据...');
    try {
        const [pRes, eRes] = await Promise.all([
            BmobAPI.get('Project'),
            BmobAPI.get('Evaluation')
        ]);

        // 转换 Bmob 数据格式为本地格式
        cloudCache.projects = (pRes.results || []).map(p => ({
            id: p.projectId,
            name: p.name,
            description: p.description,
            creator: p.creator,
            created_at: p.createdAt || p.created_at,
            images: p.images || [],
            links: p.links || [],
            objectId: p.objectId  // 保存 Bmob 的 objectId 用于后续操作
        }));

        cloudCache.evaluations = (eRes.results || []).map(e => ({
            id: e.evalId,
            project_id: e.projectId,
            evaluator_id: e.evaluatorId,
            evaluator: e.evaluator,
            department: e.department,
            total_score: e.totalScore,
            sub_scores: e.subScores || {},
            submitted_at: e.submittedAt || e.created_at,
            objectId: e.objectId  // 保存 Bmob 的 objectId
        }));

        lastSyncTime = Date.now();
        console.log(`✅ 同步完成：${cloudCache.projects.length} 个项目，${cloudCache.evaluations.length} 条评估`);
        return true;
    } catch (e) {
        console.error('❌ Bmob 同步失败:', e.message || e);
        return false;
    }
}

// 启动定时轮询（30 秒一次）
function startPolling() {
    if (!isCloudMode() || pollTimer) return;
    pollTimer = setInterval(async () => {
        const ok = await syncFromCloud();
        if (ok && typeof refreshCurrentView === 'function') refreshCurrentView();
    }, 30000);
    console.log('⏱ 已启动 30 秒自动同步');
}

// ==================== 数据存储模块 ====================
const DataStore = {

    getDB() {
        if (isCloudMode()) {
            return {
                projects:    cloudCache.projects,
                evaluations: cloudCache.evaluations,
                version:     CONFIG.VERSION
            };
        }
        return this.getLocalDB();
    },

    getLocalDB() {
        try {
            const raw = localStorage.getItem(CONFIG.DB_KEY);
            return raw ? JSON.parse(raw) : { projects: [], evaluations: [], version: CONFIG.VERSION };
        } catch (e) {
            return { projects: [], evaluations: [], version: CONFIG.VERSION };
        }
    },

    saveDB(db) {
        try {
            localStorage.setItem(CONFIG.DB_KEY, JSON.stringify(db));
            if (!isCloudMode()) {
                cloudCache.projects    = db.projects;
                cloudCache.evaluations = db.evaluations;
            }
            return true;
        } catch (e) {
            console.error('保存本地数据失败:', e);
            if (typeof showAlert === 'function') showAlert('数据保存失败，可能是存储空间不足', 'error');
            return false;
        }
    },

    // ===== 项目操作 =====

    async createProject(project) {
        if (isCloudMode()) {
            try {
                await BmobAPI.post('Project', {
                    projectId: project.id,
                    name: project.name,
                    description: project.description || '',
                    creator: project.creator,
                    images: project.images || [],
                    links: project.links || [],
                    created_at: project.created_at
                });
                await syncFromCloud();
                return project;
            } catch (e) {
                console.error('Bmob 创建项目失败，降级本地:', e.message || e);
            }
        }
        const db = this.getLocalDB();
        db.projects.push(project);
        this.saveDB(db);
        return project;
    },

    async updateProject(projectId, updates) {
        if (isCloudMode()) {
            try {
                // 先查找 objectId
                const db = this.getDB();
                const project = db.projects.find(p => p.id === projectId);
                if (project && project.objectId) {
                    const updateData = {};
                    if (updates.name !== undefined) updateData.name = updates.name;
                    if (updates.description !== undefined) updateData.description = updates.description;
                    if (updates.images !== undefined) updateData.images = updates.images;
                    if (updates.links !== undefined) updateData.links = updates.links;
                    await BmobAPI.put('Project', project.objectId, updateData);
                }
                await syncFromCloud();
                return { id: projectId, ...updates };
            } catch (e) {
                console.error('Bmob 更新项目失败，降级本地:', e.message || e);
            }
        }
        const db = this.getLocalDB();
        const i = db.projects.findIndex(p => p.id === projectId);
        if (i !== -1) { db.projects[i] = { ...db.projects[i], ...updates }; this.saveDB(db); return db.projects[i]; }
        return null;
    },

    async deleteProject(projectId) {
        if (isCloudMode()) {
            try {
                // 先删除该项目的所有评估
                const evals = await this._getEvalsByProject(projectId);
                for (const ev of evals) {
                    if (ev.objectId) {
                        await BmobAPI.delete('Evaluation', ev.objectId).catch(() => {});
                    }
                }
                // 删除项目
                const db = this.getDB();
                const project = db.projects.find(p => p.id === projectId);
                if (project && project.objectId) {
                    await BmobAPI.delete('Project', project.objectId);
                }
                await syncFromCloud();
                return true;
            } catch (e) {
                console.error('Bmob 删除项目失败，降级本地:', e.message || e);
            }
        }
        const db = this.getLocalDB();
        db.projects    = db.projects.filter(p => p.id !== projectId);
        db.evaluations = db.evaluations.filter(e => e.project_id !== projectId);
        this.saveDB(db);
        return true;
    },

    // ===== 评估操作 =====

    async createEvaluation(evaluation) {
        if (isCloudMode()) {
            try {
                await BmobAPI.post('Evaluation', {
                    evalId: evaluation.id,
                    projectId: evaluation.project_id,
                    evaluatorId: evaluation.evaluator_id,
                    evaluator: evaluation.evaluator,
                    department: evaluation.department,
                    totalScore: evaluation.total_score,
                    subScores: evaluation.sub_scores || {},
                    submittedAt: evaluation.submitted_at
                });
                await syncFromCloud();
                return evaluation;
            } catch (e) {
                console.error('Bmob 创建评估失败，降级本地:', e.message || e);
            }
        }
        const db = this.getLocalDB();
        db.evaluations.push(evaluation);
        this.saveDB(db);
        return evaluation;
    },

    async updateEvaluation(evalId, updates) {
        if (isCloudMode()) {
            try {
                const db = this.getDB();
                const evalData = db.evaluations.find(e => e.id === evalId);
                if (evalData && evalData.objectId) {
                    await BmobAPI.put('Evaluation', evalData.objectId, updates);
                }
                await syncFromCloud();
                return { id: evalId, ...updates };
            } catch (e) {
                console.error('Bmob 更新评估失败，降级本地:', e.message || e);
            }
        }
        const db = this.getLocalDB();
        const i = db.evaluations.findIndex(e => e.id === evalId);
        if (i !== -1) { db.evaluations[i] = { ...db.evaluations[i], ...updates }; this.saveDB(db); return db.evaluations[i]; }
        return null;
    },

    async deleteEvaluation(evalId) {
        if (isCloudMode()) {
            try {
                const db = this.getDB();
                const evalData = db.evaluations.find(e => e.id === evalId);
                if (evalData && evalData.objectId) {
                    await BmobAPI.delete('Evaluation', evalData.objectId);
                }
                await syncFromCloud();
                return true;
            } catch (e) {
                console.error('Bmob 删除评估失败，降级本地:', e.message || e);
            }
        }
        const db = this.getLocalDB();
        db.evaluations = db.evaluations.filter(e => e.id !== evalId);
        this.saveDB(db);
        return true;
    },

    // 内部：按项目查评估（用于级联删除）
    async _getEvalsByProject(projectId) {
        if (isCloudMode()) {
            try {
                const res = await BmobAPI.get('Evaluation', { projectId: projectId }, '-createdAt', 100);
                return (res.results || []).map(e => ({
                    id: e.evalId,
                    objectId: e.objectId
                }));
            } catch (e) { return []; }
        }
        return this.getLocalDB().evaluations.filter(e => e.project_id === projectId);
    },

    // ===== 用户会话 =====
    getCurrentUser() {
        try { const d = localStorage.getItem(CONFIG.USER_KEY); return d ? JSON.parse(d) : null; } catch (e) { return null; }
    },
    saveCurrentUser(user)   { localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user)); },
    removeCurrentUser()     { localStorage.removeItem(CONFIG.USER_KEY); },

    // ===== 备份 =====
    createBackup() {
        try {
            const backup = { data: this.getLocalDB(), timestamp: Date.now(), version: CONFIG.VERSION };
            localStorage.setItem(CONFIG.BACKUP_KEY, JSON.stringify(backup));
            return true;
        } catch (e) { return false; }
    },
    getBackup() {
        try { const d = localStorage.getItem(CONFIG.BACKUP_KEY); return d ? JSON.parse(d) : null; } catch (e) { return null; }
    },
    restoreBackup() {
        const backup = this.getBackup();
        if (backup?.data) { this.saveDB(backup.data); return true; }
        return false;
    },
    clearAll() {
        localStorage.removeItem(CONFIG.DB_KEY);
        localStorage.removeItem(CONFIG.BACKUP_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
    }
};

// ==================== 工具函数模块 ====================
const Utils = {
    // 生成唯一ID
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    },

    // 格式化日期
    formatDate(timestamp, short = false) {
        if (!timestamp) return '未知时间';
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return '无效时间';
        
        if (short) {
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        }
        return date.toLocaleString('zh-CN');
    },

    // 获取部门名称
    getDeptName(dept) {
        return DEPT_CONFIG[dept]?.name || dept;
    },

    // 获取部门图标
    getDeptIcon(dept) {
        return DEPT_CONFIG[dept]?.icon || '';
    },

    // 获取评分等级（基于百分制分数）
    getLevel(score100) {
        const level = LEVEL_CONFIG.find(l => score100 >= l.min);
        return level || LEVEL_CONFIG[LEVEL_CONFIG.length - 1];
    },
    
    // 获取评分等级（基于5分制分数，自动转换为百分制）
    getLevelFrom5(score5) {
        const score100 = score5 * 20;
        return Utils.getLevel(score100);
    },

    // 防抖函数
    debounce(fn, delay = 300) {
        let timer = null;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    },

    // 验证图片文件
    validateImage(file) {
        if (!CONFIG.ALLOWED_IMAGE_TYPES.includes(file.type)) {
            return { valid: false, error: '不支持的图片格式，请使用 JPG、PNG、GIF 或 WebP 格式' };
        }
        if (file.size > CONFIG.MAX_IMAGE_SIZE) {
            return { valid: false, error: `图片大小不能超过 ${CONFIG.MAX_IMAGE_SIZE / 1024 / 1024}MB` };
        }
        return { valid: true };
    },

    // 读取文件为 Base64
    readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsDataURL(file);
        });
    },

    // 深拷贝
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }
};

// ==================== 评分标准配置 ====================
const RatingStandards = {
    market: {
        m1_1: {
            title: '是否属于 Top 级需求/体验？',
            standards: [
                { score: 5, title: '战略核心', desc: '该功能是用户购买的首要决策因素，超过 80% 的目标用户将其列为"必备"功能；所有头部竞品均作为核心卖点；缺失将导致产品失去市场竞争力。' },
                { score: 4, title: '关键优势', desc: '形成产品差异化、提升溢价能力的关键。超 50% 用户高度重视；领先竞品已部署并宣传；显著增强用户忠诚度和口碑传播。' },
                { score: 3, title: '重要提升', desc: '重要的体验加分项，但非决定性要素。部分细分用户喜爱；竞品配置参差；有更好，没有也能接受。' },
                { score: 2, title: '锦上添花', desc: '仅带来微小优化，感知弱。少数用户在特定场景提及；竞品较少宣传；对吸引力影响甚微。' },
                { score: 1, title: '无关紧要', desc: '可能为"伪需求"或极客型功能，对主流市场无实际价值；调研中未被主动提及；无竞品跟进。' }
            ]
        },
        m1_2: {
            title: '是否属于未被满足的需求？',
            standards: [
                { score: 5, title: '颠覆性空白', desc: '广泛强烈需求，现有技术完全无法实现或体验极差；用户痛点明确且长期存在；行业公认难点；突破可开创全新市场。' },
                { score: 4, title: '显著缺口', desc: '现有方案明显缺陷，用户妥协使用但期待更优解；能清晰描述不便；替代方案成本高或体验打折；改进后获显著份额。' },
                { score: 3, title: '有限优化', desc: '属现有功能升级而非从无到有；用户期待但不迫切；竞品已在尝试改进。' },
                { score: 2, title: '过度需求', desc: '未经验证的小众需求，仅极少数前沿用户提出；满足需付出不成比例成本。' },
                { score: 1, title: '伪需求/已满足', desc: '需求不存在或已被成熟方案完美解决；市场已有高效低成本标准化解决方案。' }
            ]
        },
        m1_3: {
            title: '是否属于 Top 级痛点？',
            standards: [
                { score: 5, title: '致命痛点', desc: '问题直接导致产品无法使用、引发安全/健康风险，或招致大量投诉与流失；是差评退货主因；用户愿支付明显溢价解决。' },
                { score: 4, title: '严重困扰', desc: '严重影响核心体验流畅性和愉悦感，频繁抱怨；显著降低使用频率或时长；阻止推荐的关键障碍。' },
                { score: 3, title: '可感知不便', desc: '造成不便但用户已习惯或能找到变通方法；特定场景下会吐槽；负面影响尚可忍受；非反馈高频词。' },
                { score: 2, title: '轻微烦恼', desc: '仅在极端条件或细致对比下察觉，影响甚微；少数完美主义者提及；不影响正常功能和基本体验。' },
                { score: 1, title: '无感或臆测', desc: '实际使用几乎无法感知，或仅理论推测；无真实用户反馈支撑；解决后用户毫无感知或认为理所当然。' }
            ]
        },
        m2_1: {
            title: '竞争对手有没有（市场竞争格局）？',
            standards: [
                { score: 5, title: '市场空白', desc: 'Top5 竞品均未实现，属未开发"需求蓝海"；能塑造全新卖点或定义新品类，具备战略先发优势。' },
                { score: 4, title: '局部差异化', desc: '仅 1-2 家领先竞品拥有，尚未普及；建立差异化竞争力的关键窗口期；可挑战领先者，抢占高端心智。' },
                { score: 3, title: '主流卖点', desc: '超半数 Top5 竞品已作为重要卖点宣传，成为"资格赛"项目；具备则不失竞争力，但难以获得额外溢价。' },
                { score: 2, title: '基础标配', desc: '已成为行业基础配置，所有主流竞品具备且不再专门宣传；用户视为理所当然；缺失招致差评，拥有无附加价值。' },
                { score: 1, title: '落后过时', desc: '竞品已普遍实现更优替代方案，或该方向被验证不成功；很可能浪费资源。' }
            ]
        },
        m2_2: {
            title: '该技术方案溢价如何（用户支付意愿）？',
            standards: [
                { score: 5, title: '高额溢价', desc: '用户愿为此支付超原价 30% 以上费用；功能具"颠覆性"或"成瘾性"体验，是强购买驱动因素。' },
                { score: 4, title: '显著溢价', desc: '用户愿支付 15%-30% 明确溢价；是重要差异化理由，有效提升定位和平均售价。' },
                { score: 3, title: '支撑原价', desc: '难单独支撑大幅溢价，但能帮助维持当前价格区间不失价；属"人有我必须有"，缺失会导致被迫降价。' },
                { score: 2, title: '无法溢价', desc: '对提价无贡献，仅作普通营销话术；完全无法支撑任何溢价，用户认为价值已含于基础价格中。' },
                { score: 1, title: '负溢价', desc: '因增加复杂度、降低可靠性或负面体验而产生价值折扣。' }
            ]
        },
        m3_1: {
            title: '市场规模',
            standards: [
                { score: 5, title: '百亿级主流市场', desc: '百亿以上规模的成熟主流市场。' },
                { score: 4, title: '十亿级高增市场', desc: '十至数十亿级正在快速增长的核心市场。' },
                { score: 3, title: '数亿级利基市场', desc: '数亿级的特定细分或新兴市场。' },
                { score: 2, title: '千万级小众市场', desc: '千万到亿级的狭窄或专业市场。' },
                { score: 1, title: '百万级探索市场', desc: '目标不确定或规模极小（<千万人民币），属前沿探索或概念验证阶段。' }
            ]
        },
        m3_2: {
            title: '市场成长性',
            standards: [
                { score: 5, title: '爆发增长期', desc: '年增长率>30%，处于技术或需求爆发初期，由颠覆性技术或新场景驱动。' },
                { score: 4, title: '高速成长期', desc: '年增 15%-30%，已越爆发点，进入高速稳定增长通道。' },
                { score: 3, title: '稳定成熟期', desc: '稳定增长 5%-15%，与 GDP 增速相近或略高，进入成熟阶段。' },
                { score: 2, title: '停滞期', desc: '增长基本停滞，需求饱和，以存量竞争为主。' },
                { score: 1, title: '衰退期', desc: '因技术替代、需求转移或政策原因持续萎缩。' }
            ]
        }
    },
    tech: {
        t1_1: {
            title: '创新程度',
            standards: [
                { score: 5, title: '颠覆性/原理性创新', desc: '属高创新高必要或标准必要技术（SEP）、行业事实标准/通用协议核心部分；法律或事实上进入市场必须使用的手段；"从 0 到 1"的发明。' },
                { score: 4, title: '核心突破性创新', desc: '在现有原理上取得关键突破，实现性能阶跃式提升；现有路径难以通过简单优化达到同等效果；"从 1 到 10"的重大改进。' },
                { score: 3, title: '显著优化型创新', desc: '在现有基础上有效改进或组合优化，有一定新颖性；虽非重大创新，但对该项目合理有益；存在竞争对手通过不同设计实现类似效果的替代可能。' },
                { score: 2, title: '常规改进/微创新', desc: '属本领域技术人员的常规设计选择或已知技术的简单应用，如参数调整、材料替换等。' },
                { score: 1, title: '无创新/公知技术应用', desc: '直接采用公知技术、开源方案或成熟设计，未产生超出预期的技术效果。' }
            ]
        },
        t2_1: {
            title: '技术竞争优势',
            standards: [
                { score: 5, title: '代际倍数级优势', desc: '在核心性能参数上实现倍数级提升（如效率提升 100% 以上，或成本降低 50% 以上），或创造出前所未有的全新体验，且竞争对手在现有技术路径下短期内（1-2 年）无法追赶。' },
                { score: 4, title: '显著领先级优势', desc: '在多个关键指标上（至少包含成本、体验、性能中的两项）对竞品形成清晰、可量化的显著优势（如性能提升 30%-50%，成本降低 15%-30%）。' },
                { score: 3, title: '差异化比较优势', desc: '在部分指标上优于竞品，或在综合平衡性上更优（如性能略优 + 成本略低），但优势不具压倒性。' },
                { score: 2, title: '行业持平级表现', desc: '在成本、体验、性能等主要方面与行业主流竞品水平基本持平，无明显优势或劣势。属于"人有我有"的合格水平。' },
                { score: 1, title: '落后或存在短板', desc: '在关键指标上明显落后于主流竞品（如成本更高、性能更差），或为达到同等性能需牺牲其他重要体验（如体积过大、功耗过高）。' }
            ]
        },
        t3_1: {
            title: '技术可扩展（战略）性',
            standards: [
                { score: 5, title: '强平台型技术', desc: '应对增长和变化的能力强，边际成本低。可横向应用于公司多个主营业务板块（声、光、香），并纵向衍生出多代产品和大量改进型专利。' },
                { score: 4, title: '产品线通用核心技术', desc: '可作为公司某一产品线（如所有投影灯产品）未来多款产品的核心通用技术，能支撑其 2-3 代产品的迭代升级。' },
                { score: 3, title: '相关支持型技术', desc: '主要服务于某一特定型号或系列产品的关键功能模块，其迭代主要跟随主技术发展，自身有优化路径但天花板可见。' },
                { score: 2, title: '探索或边缘型技术', desc: '为解决某个非常具体、孤立的产品问题而设计，其技术思路和实现方式未来是否投入大量资源发展的决策尚不明确，迭代路径模糊。' },
                { score: 1, title: '偏离或淘汰型技术', desc: '方案仅针对当前特定需求设计，结构僵化、高度耦合。任何业务量的增长或功能变更都可能需要大规模重构甚至重写。' }
            ]
        }
    },
    patent: {
        p1_1: {
            title: '技术方案的新颖性与创造性高度',
            standards: [
                { score: 5, title: '极高授权前景', desc: '经初步检索，未发现任何密切相关的现有技术。技术方案具有出乎意料的技术效果或解决了长期存在的技术难题，创造性突出。' },
                { score: 4, title: '高授权前景', desc: '存在一些相关现有技术，但本方案具有明确的区别特征和显著进步，创造性论证路径清晰。' },
                { score: 3, title: '中等授权前景', desc: '与现有技术区别较小，进步为常规优化或有限效果提升。创造性处于临界状态，授权存在不确定性。' },
                { score: 2, title: '低授权前景', desc: '与现有技术高度相似，区别仅在于公知常识的简单替换或微小调整，缺乏创造性。' },
                { score: 1, title: '很有可能授权不下', desc: '技术方案已被现有技术完全公开，或属于科学发现、智力活动规则等不授予专利权的主题。' }
            ]
        },
        p2_1: {
            title: '专利申请文件撰写质量与保护范围平衡空间',
            standards: [
                { score: 5, title: '撰写空间极佳', desc: '技术方案包含多个可分层保护的技术点，且实施例丰富，能支撑一个由宽到窄的权利要求梯度。代理人能构建强大的"金字塔"式权利要求体系，在确权和维权中拥有高度灵活性，平衡点易于把握。' },
                { score: 4, title: '撰写空间良好', desc: '技术方案核心创新点明确，有若干扩展实施例，能支撑一组具有恰当范围的权利要求。通过高质量撰写，能获得一个范围合理、说明书支撑牢固的权利要求，平衡点较为清晰。' },
                { score: 3, title: '撰写空间有限', desc: '技术方案创新点较为单一和具体，可概括的余地小，扩展实施例不足。权利要求范围可能较窄，容易"被绕过"。' },
                { score: 2, title: '撰写空间局促', desc: '技术方案几乎只能以一种非常具体的方式描述，任何概括都可能面临不支持或缺乏创造性的风险。比较难撰写出有价值的权利要求，即便授权也形同虚设。专利价值极低。' },
                { score: 1, title: '无法有效撰写', desc: '技术方案本质是功能或结果的描述，缺乏实现该功能的具体技术手段，或技术手段可能不可披露，无法形成有法律效力的权利要求。' }
            ]
        },
        p3_1: {
            title: '专利维权取证的难易程度',
            standards: [
                { score: 5, title: '极易取证维权', desc: '侵权证据易于公开获取，侵权判定标准清晰直观（"一目了然"原则）。维权证明成本低、成功率高。' },
                { score: 4, title: '较易取证维权', desc: '通过常规的产品拆解、简单测试或软件解析即可获得关键证据，侵权比对明确。涉及内部机械结构、硬件电路板布局或可通过反汇编获取的软件流程。' },
                { score: 3, title: '取证存在一定难度', desc: '涉及特定制造方法、热处理工艺、复杂的算法，证据可能存在于生产工艺、后台系统或需要复杂专业检测才能获得的数据。' },
                { score: 2, title: '取证难度很大', desc: '侵权行为高度隐蔽或发生在企业内部，证据极难获取，或侵权判定需要复杂的法律技术论证。' },
                { score: 1, title: '几乎无法取证维权', desc: '侵权行为无法被外部观察或检测，或专利保护的是纯理论构思、无法落地的方案。此类专利存在的意义一般仅具有威慑或宣传价值，无实际维权可能。' }
            ]
        }
    }
};

// ==================== 全局状态 ====================
let currentUser = null;
let currentProjectId = null;
let radarChartInstance = null;
let editProjectNewImages = [];

// ==================== UI 工具函数 ====================
function show(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    // 对于弹窗元素，使用 active 类
    if (el.classList.contains('modal-overlay')) {
        el.classList.add('active');
    } else {
        el.classList.remove('hidden');
    }
}

function hide(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    // 对于弹窗元素，移除 active 类
    if (el.classList.contains('modal-overlay')) {
        el.classList.remove('active');
    } else {
        el.classList.add('hidden');
    }
}

function showAlert(message, type = 'info') {
    const alertEl = document.getElementById('loginAlert');
    if (alertEl) {
        alertEl.className = `alert alert-${type}`;
        alertEl.textContent = message;
        show('loginAlert');
        setTimeout(() => hide('loginAlert'), 5000);
    }
}

// ==================== 用户认证模块 ====================
function handleLogin() {
    const realName = document.getElementById('loginRealName')?.value.trim();
    const department = document.getElementById('loginDept')?.value;
    const inviteCode = document.getElementById('loginInviteCode')?.value.trim();

    if (!realName || !department) {
        showAlert('请填写完整信息', 'error');
        return;
    }

    if (!inviteCode || inviteCode !== CONFIG.INVITE_CODE) {
        showAlert('邀请码错误，请联系管理员获取正确的邀请码', 'error');
        return;
    }

    currentUser = {
        id: `${realName}_${department}`,
        real_name: realName,
        department
    };

    DataStore.saveCurrentUser(currentUser);
    initApp();
}

function logout() {
    if (confirm('确定要退出登录吗？')) {
        DataStore.removeCurrentUser();
        location.reload();
    }
}

async function initApp() {
    currentUser = DataStore.getCurrentUser();
    if (!currentUser) return;

    // 初始化 Bmob
    initBmob();
    
    // 如果是云端模式，同步数据并启动轮询
    if (isCloudMode()) {
        console.log('正在连接云端数据库...');
        await syncFromCloud();
        startPolling();
        console.log('云端同步完成，已启动自动轮询');
    }

    hide('loginSection');
    show('mainApp');

    document.getElementById('userAvatar').textContent = currentUser.real_name.charAt(0);
    document.getElementById('userName').textContent = currentUser.real_name;
    document.getElementById('userDept').textContent = `${Utils.getDeptIcon(currentUser.department)} ${Utils.getDeptName(currentUser.department)}`;

    loadProjects();
    updateBackupStatus();
}

// 刷新当前视图（用于实时同步后）
function refreshCurrentView() {
    const activeTab = document.querySelector('.nav-tab.active');
    if (activeTab) {
        const tabName = activeTab.dataset.tab;
        if (tabName === 'projects') {
            loadProjects();
        } else if (tabName === 'history') {
            loadHistory();
        } else if (currentProjectId) {
            // 如果在项目详情页，刷新详情
            const db = DataStore.getDB();
            const project = db.projects.find(p => p.id === currentProjectId);
            const evals = db.evaluations.filter(e => e.project_id === currentProjectId);
            if (project) {
                renderProjectDetail(project, evals);
            }
        }
    }
}

// ==================== 导航模块 ====================
function switchTab(tabName) {
    // 更新导航标签状态
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // 更新内容区域
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName + 'Tab')?.classList.add('active');

    // 加载对应数据
    switch (tabName) {
        case 'projects':
            loadProjects();
            break;
        case 'history':
            loadHistory();
            break;
        case 'settings':
            updateBackupStatus();
            break;
    }
}

function backToProjects() {
    switchTab('projects');
}

function toggleDimension(header) {
    const body = header.nextElementSibling;
    const arrow = header.querySelector('.arrow');
    body.classList.toggle('show');
    arrow.classList.toggle('rotate');
}

// ==================== 项目管理模块 ====================
function loadProjects() {
    const db = DataStore.getDB();
    const list = document.getElementById('projectList');
    const searchTerm = document.getElementById('projectSearch')?.value.toLowerCase() || '';
    const filterType = document.getElementById('projectFilter')?.value || 'all';

    let projects = db.projects;

    // 搜索筛选
    if (searchTerm) {
        projects = projects.filter(p => p.name.toLowerCase().includes(searchTerm));
    }

    // 类型筛选
    if (filterType === 'my') {
        projects = projects.filter(p => p.creator === currentUser.real_name);
    } else if (filterType === 'completed' || filterType === 'pending') {
        projects = projects.filter(p => {
            const evals = db.evaluations.filter(e => e.project_id === p.id);
            const depts = [...new Set(evals.map(e => e.department))];
            const isComplete = depts.includes('market') && depts.includes('tech') && depts.includes('patent');
            return filterType === 'completed' ? isComplete : !isComplete;
        });
    }

    if (projects.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <p>暂无项目</p>
                <small>点击"新建项目"创建第一个评估项目</small>
            </div>
        `;
        return;
    }

    // 按创建时间倒序排列
    projects.sort((a, b) => b.created_at - a.created_at);

    list.innerHTML = projects.map(project => renderProjectCard(project, db)).join('');
}

function renderProjectCard(project, db) {
    const evals = db.evaluations.filter(e => e.project_id === project.id);
    const depts = [...new Set(evals.map(e => e.department))];

    const hasMarket = depts.includes('market');
    const hasTech = depts.includes('tech');
    const hasPatent = depts.includes('patent');
    const isComplete = hasMarket && hasTech && hasPatent;

    let statusHtml = '';
    let actionsHtml = '';

    if (isComplete && evals.length >= 3) {
        const avgScore5 = (evals.reduce((sum, e) => sum + (e.total_score || 0), 0) / evals.length);
        const avgScore100 = (avgScore5 * 20).toFixed(1);
        const level = Utils.getLevel(parseFloat(avgScore100));
        // 综合评分和AI分析报告放在同一行，靠左对齐
        statusHtml = `
            <div class="project-status-row-left">
                <div class="project-status status-completed" style="cursor: pointer;" onclick="event.stopPropagation();showScoreRangeModal('${avgScore100}', '综合')" title="点击查看分数段价值参考标准">
                    📊 综合评分：${avgScore100}分
                </div>
                <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();showUnifiedAIReport('${project.id}')">📋 生成AI分析报告</button>
            </div>
        `;
    } else {
        const missing = [];
        if (!hasMarket) missing.push('市场端');
        if (!hasTech) missing.push('研发端');
        if (!hasPatent) missing.push('专利端');
        statusHtml = `<div class="project-status status-pending">⚠️ 待评估：${missing.join('、')}</div>`;
    }

    // 获取最新评分
    const latestScores = {};
    evals.forEach(e => {
        if (!latestScores[e.department] || e.submitted_at > latestScores[e.department].submitted_at) {
            latestScores[e.department] = e;
        }
    });

    const scoreGridHtml = ['market', 'tech', 'patent']
        .filter(dept => latestScores[dept])
        .map(dept => {
            const score5 = latestScores[dept].total_score || 0;
            const score100 = (score5 * 20).toFixed(1);
            const evaluator = latestScores[dept].evaluator || '未知';
            const submitTime = Utils.formatDate(latestScores[dept].submitted_at, true);
            const evalId = latestScores[dept].id;
            return `
            <div class="score-item">
                <div class="score-label">${Utils.getDeptName(dept)}</div>
                <div class="score-value">${score100}</div>
                <div style="font-size: 0.7rem; color: #95a5a6;">5分制: ${score5.toFixed(2)}</div>
                <div style="font-size: 0.65rem; color: #7f8c8d; margin-top: 4px;">${evaluator} | ${submitTime}</div>
                <button class="btn btn-secondary btn-sm" style="margin-top: 8px; font-size: 0.7rem; padding: 4px 10px;" onclick="event.stopPropagation();showDeptDetailModal('${evalId}')">📋 查看详情</button>
            </div>
        `}).join('');

    const canEdit = project.creator === currentUser.real_name;

    return `
        <div class="project-card" onclick="openProject('${project.id}')">
            ${canEdit ? `
                <div class="project-card-actions">
                    <button class="card-action-btn card-edit-btn" onclick="event.stopPropagation();editProject('${project.id}')" title="编辑">✏️</button>
                    <button class="card-action-btn card-delete-btn" onclick="event.stopPropagation();confirmDeleteProject('${project.id}')" title="删除">🗑️</button>
                </div>
            ` : ''}
            <div class="project-title">${escapeHtml(project.name)}</div>
            <div class="project-meta">创建人：${project.creator} | ${Utils.formatDate(project.created_at)}</div>
            <div class="project-meta">已参与：${depts.map(d => Utils.getDeptName(d)).join('、') || '暂无'}</div>
            ${statusHtml}
            ${actionsHtml ? `<div class="mt-2">${actionsHtml}</div>` : ''}
            ${scoreGridHtml ? `<div class="score-grid">${scoreGridHtml}</div>` : ''}
        </div>
    `;
}

function filterProjects() {
    loadProjects();
}

// ==================== 图片处理模块 ====================
async function handleImagePreview(input) {
    const container = document.getElementById('imagePreviewContainer');
    const files = Array.from(input.files);
    const currentCount = container.querySelectorAll('.preview-item').length;

    if (currentCount + files.length > CONFIG.MAX_IMAGES) {
        alert(`最多只能上传 ${CONFIG.MAX_IMAGES} 张图片，当前还可上传 ${CONFIG.MAX_IMAGES - currentCount} 张`);
        input.value = '';
        return;
    }

    for (const file of files) {
        const validation = Utils.validateImage(file);
        if (!validation.valid) {
            alert(`${file.name}: ${validation.error}`);
            continue;
        }

        try {
            const base64 = await Utils.readFileAsBase64(file);
            const div = document.createElement('div');
            div.className = 'preview-item';
            div.innerHTML = `
                <img src="${base64}" alt="预览">
                <button class="preview-remove" onclick="this.parentElement.remove()" type="button">×</button>
            `;
            container.appendChild(div);
        } catch (e) {
            alert(`读取 ${file.name} 失败`);
        }
    }

    input.value = '';
}

async function handleEditImagePreview(input) {
    const container = document.getElementById('editImagePreviewContainer');
    const files = Array.from(input.files);

    editProjectNewImages = [];
    container.innerHTML = '';

    for (const file of files) {
        const validation = Utils.validateImage(file);
        if (!validation.valid) {
            alert(`${file.name}: ${validation.error}`);
            continue;
        }

        try {
            const base64 = await Utils.readFileAsBase64(file);
            editProjectNewImages.push(base64);
            const div = document.createElement('div');
            div.className = 'preview-item';
            div.innerHTML = `<img src="${base64}" alt="预览">`;
            container.appendChild(div);
        } catch (e) {
            alert(`读取 ${file.name} 失败`);
        }
    }
}

// ==================== 项目操作模块 ====================
async function createProject() {
    const nameInput = document.getElementById('newProjectName');
    const descInput = document.getElementById('newProjectDesc');
    const linkInput = document.getElementById('newProjectLink');

    const name = nameInput.value.trim();
    if (!name) {
        alert('请输入项目名称');
        return;
    }

    // 收集图片
    const previewItems = document.querySelectorAll('#imagePreviewContainer .preview-item img');
    const images = Array.from(previewItems).map(img => img.src);

    const project = {
        id: Utils.generateId(),
        name,
        description: descInput.value.trim(),
        creator: currentUser.real_name,
        created_at: new Date().toISOString(),
        images,
        links: linkInput.value.trim() ? [linkInput.value.trim()] : []
    };

    // 使用 DataStore 创建项目（支持云端同步）
    DataStore.createProject(project).then(() => {
        // 重置表单
        nameInput.value = '';
        descInput.value = '';
        linkInput.value = '';
        document.getElementById('imagePreviewContainer').innerHTML = '';

        alert('项目创建成功！');
        switchTab('projects');
    }).catch(err => {
        console.error('创建项目失败:', err);
        alert('创建项目失败，请重试');
    });
}

function editProject(projectId) {
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);

    if (!project) {
        alert('项目不存在');
        return;
    }

    if (project.creator !== currentUser.real_name) {
        alert('只有项目创建者才能编辑项目');
        return;
    }

    window.currentEditProjectId = projectId;
    editProjectNewImages = [];

    document.getElementById('editProjectName').value = project.name;
    document.getElementById('editProjectDesc').value = project.description || '';
    document.getElementById('editProjectLink').value = project.links?.[0] || '';

    // 显示现有图片
    const existingContainer = document.getElementById('editExistingImages');
    if (project.images && project.images.length > 0) {
        existingContainer.innerHTML = project.images.map((img, i) => `
            <div class="preview-item">
                <img src="${img}" alt="图片${i + 1}">
                <button class="preview-remove" onclick="removeEditImage(${i})" type="button">×</button>
            </div>
        `).join('');
    } else {
        existingContainer.innerHTML = '<p class="text-center" style="color:#999;">暂无图片</p>';
    }

    document.getElementById('editImagePreviewContainer').innerHTML = '';
    document.getElementById('editProjectImages').value = '';

    show('editProjectModal');
}

function removeEditImage(index) {
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === window.currentEditProjectId);
    if (project && project.images) {
        project.images.splice(index, 1);
        DataStore.saveDB(db);
        editProject(window.currentEditProjectId);
    }
}

function closeEditModal() {
    hide('editProjectModal');
    window.currentEditProjectId = null;
    editProjectNewImages = [];
}

async function saveProjectEdit() {
    const name = document.getElementById('editProjectName').value.trim();
    const desc = document.getElementById('editProjectDesc').value.trim();
    const link = document.getElementById('editProjectLink').value.trim();

    if (!name) {
        alert('请输入项目名称');
        return;
    }

    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === window.currentEditProjectId);

    if (!project) {
        alert('项目不存在');
        return;
    }

    const updates = {
        name: name,
        description: desc,
        links: link ? [link] : [],
        updated_at: Date.now()
    };

    // 添加新图片
    if (editProjectNewImages.length > 0) {
        const currentImages = project.images || [];
        const availableSlots = CONFIG.MAX_IMAGES - currentImages.length;
        updates.images = [...currentImages, ...editProjectNewImages.slice(0, availableSlots)];
    }

    await DataStore.updateProject(window.currentEditProjectId, updates);
    closeEditModal();
    alert('项目已更新！');
    loadProjects();
}

function confirmDeleteProject(projectId) {
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);

    if (!project) {
        alert('项目不存在');
        return;
    }

    if (project.creator !== currentUser.real_name) {
        alert('只有项目创建者才能删除项目');
        return;
    }

    showConfirmModal(
        '删除项目',
        `确定要删除项目"${project.name}"吗？\n\n此操作不可恢复，所有相关评估记录也会被删除！`,
        () => deleteProject(projectId)
    );
}

async function deleteProject(projectId) {
    await DataStore.deleteProject(projectId);
    closeConfirmModal();
    alert('项目已删除');
    loadProjects();
}

// ==================== 确认对话框 ====================
function showConfirmModal(title, message, onConfirm) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmBtn').onclick = onConfirm;
    show('confirmModal');
}

function closeConfirmModal() {
    hide('confirmModal');
}

// ==================== 分数段价值参考标准弹窗 ====================
function showScoreRangeModal(score, type) {
    const scoreValue = parseFloat(score);
    let title = '';
    let content = '';
    
    if (type === '综合') {
        title = '📊 综合评分分数段价值参考标准';
    } else {
        title = `📊 ${type}分数段价值参考标准`;
    }
    
    // 根据分数确定显示的参考标准
    let currentLevel = '';
    if (scoreValue >= 90) {
        currentLevel = 'excellent';
    } else if (scoreValue >= 80) {
        currentLevel = 'good';
    } else if (scoreValue >= 70) {
        currentLevel = 'average';
    } else if (scoreValue >= 60) {
        currentLevel = 'caution';
    } else {
        currentLevel = 'poor';
    }
    
    // 获取星级显示
    const getStars = (count) => '★'.repeat(count);
    
    content = `
        <div class="score-range-content">
            <div class="current-score-highlight">
                <p>当前评分：<strong class="score-highlight ${currentLevel}">${scoreValue}分</strong></p>
            </div>
            
            <div class="score-range-item ${scoreValue >= 90 ? 'active' : ''}">
                <div class="score-range-header excellent">
                    <span class="score-range-title"><span class="star-icon">${getStars(5)}</span> 优秀级（90-100分）</span>
                </div>
                <div class="score-range-body">
                    <p><strong>价值定位：</strong>极具价值的优质项目，市场需求强劲、技术创新突出、可专利性良好。</p>
                    <p><strong>专利建议：</strong>强烈建议申请发明专利，优先考虑PCT国际布局。</p>
                    <p><strong>资源投入：</strong>优先配置资源，快速推进商业化落地。</p>
                    <p><strong>预期收益：</strong>高市场回报，强技术壁垒，建议重点投入。</p>
                </div>
            </div>
            
            <div class="score-range-item ${scoreValue >= 80 && scoreValue < 90 ? 'active' : ''}">
                <div class="score-range-header good">
                    <span class="score-range-title"><span class="star-icon">${getStars(4)}</span> 良好级（80-89分）</span>
                </div>
                <div class="score-range-body">
                    <p><strong>价值定位：</strong>高价值项目，整体表现良好，个别维度有提升空间。</p>
                    <p><strong>专利建议：</strong>建议申请发明专利，完善薄弱环节后提交。</p>
                    <p><strong>资源投入：</strong>稳健推进，针对性优化短板维度。</p>
                    <p><strong>预期收益：</strong>较好市场回报，一定技术壁垒，值得投入。</p>
                </div>
            </div>
            
            <div class="score-range-item ${scoreValue >= 70 && scoreValue < 80 ? 'active' : ''}">
                <div class="score-range-header average">
                    <span class="score-range-title"><span class="star-icon">${getStars(3)}</span> 中上级（70-79分）</span>
                </div>
                <div class="score-range-body">
                    <p><strong>价值定位：</strong>中等偏上价值，具备一定竞争力但存在明显短板。</p>
                    <p><strong>专利建议：</strong>建议完善后申请，或先申请实用新型专利。</p>
                    <p><strong>资源投入：</strong>控制投入，聚焦核心改进点。</p>
                    <p><strong>预期收益：</strong>中等市场回报，需差异化竞争。</p>
                </div>
            </div>
            
            <div class="score-range-item ${scoreValue >= 60 && scoreValue < 70 ? 'active' : ''}">
                <div class="score-range-header caution">
                    <span class="score-range-title"><span class="star-icon">${getStars(2)}</span> 中级（60-69分）</span>
                </div>
                <div class="score-range-body">
                    <p><strong>价值定位：</strong>中等价值，竞争力一般，需大幅改进。</p>
                    <p><strong>专利建议：</strong>谨慎评估，建议先完善技术方案。</p>
                    <p><strong>资源投入：</strong>有限投入，设定明确止损点。</p>
                    <p><strong>预期收益：</strong>市场回报不确定，需重新定位。</p>
                </div>
            </div>
            
            <div class="score-range-item ${scoreValue < 60 ? 'active' : ''}">
                <div class="score-range-header poor">
                    <span class="score-range-title"><span class="star-icon">${getStars(1)}</span> 待改进（0-59分）</span>
                </div>
                <div class="score-range-body">
                    <p><strong>价值定位：</strong>低价值项目，多个维度表现不佳。</p>
                    <p><strong>专利建议：</strong>不建议申请专利，考虑其他保护方式。</p>
                    <p><strong>资源投入：</strong>建议终止或彻底转型。</p>
                    <p><strong>预期收益：</strong>市场回报极低，需重新评估方向。</p>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('scoreRangeModalTitle').textContent = title;
    document.getElementById('scoreRangeModalContent').innerHTML = content;
    show('scoreRangeModal');
}

function closeScoreRangeModal() {
    hide('scoreRangeModal');
}

// ==================== 部门评估详情弹窗 ====================
function showDeptDetailModal(evalId) {
    const evalData = DataStore.getDB().evaluations.find(e => e.id === evalId);
    if (!evalData) {
        alert('评估数据不存在');
        return;
    }
    
    const deptName = Utils.getDeptName(evalData.department);
    const score100 = (evalData.total_score * 20).toFixed(1);
    const subScores = evalData.sub_scores || {};
    
    // 生成各维度分数表格
    let detailTableHtml = '';
    
    if (evalData.department === 'market') {
        const c1 = ((subScores.m1_1 || 0) * 0.4 + (subScores.m1_2 || 0) * 0.35 + (subScores.m1_3 || 0) * 0.25).toFixed(2);
        const c2 = ((subScores.m2_1 || 0) * 0.4 + (subScores.m2_2 || 0) * 0.6).toFixed(2);
        const c3 = (((subScores.m3_1 || 0) + (subScores.m3_2 || 0)) / 2).toFixed(2);
        detailTableHtml = `
            <table class="dimension-table">
                <thead><tr><th>评估维度</th><th>得分</th><th>权重</th><th>小计</th></tr></thead>
                <tbody>
                    <tr class="group-header"><td colspan="4">用户买不买单（50%）</td></tr>
                    <tr><td>Top级需求</td><td>${(subScores.m1_1 || 0).toFixed(1)}</td><td>40%</td><td rowspan="3">${c1}</td></tr>
                    <tr><td>未被满足需求</td><td>${(subScores.m1_2 || 0).toFixed(1)}</td><td>35%</td></tr>
                    <tr><td>Top级痛点</td><td>${(subScores.m1_3 || 0).toFixed(1)}</td><td>25%</td></tr>
                    <tr class="group-header"><td colspan="4">用户愿花多少钱（30%）</td></tr>
                    <tr><td>竞争格局</td><td>${(subScores.m2_1 || 0).toFixed(1)}</td><td>40%</td><td rowspan="2">${c2}</td></tr>
                    <tr><td>溢价能力</td><td>${(subScores.m2_2 || 0).toFixed(1)}</td><td>60%</td></tr>
                    <tr class="group-header"><td colspan="4">市场规模与增长（20%）</td></tr>
                    <tr><td>市场规模</td><td>${(subScores.m3_1 || 0).toFixed(1)}</td><td>50%</td><td rowspan="2">${c3}</td></tr>
                    <tr><td>成长性</td><td>${(subScores.m3_2 || 0).toFixed(1)}</td><td>50%</td></tr>
                </tbody>
            </table>
        `;
    } else if (evalData.department === 'tech') {
        detailTableHtml = `
            <table class="dimension-table">
                <thead><tr><th>评估维度</th><th>得分</th><th>权重</th></tr></thead>
                <tbody>
                    <tr class="group-header"><td colspan="3">创新程度（40%）</td></tr>
                    <tr><td>创新程度</td><td>${(subScores.t1_1 || 0).toFixed(1)}</td><td>100%</td></tr>
                    <tr class="group-header"><td colspan="3">竞争优势（30%）</td></tr>
                    <tr><td>相比竞品优势</td><td>${(subScores.t2_1 || 0).toFixed(1)}</td><td>100%</td></tr>
                    <tr class="group-header"><td colspan="3">可扩展性（30%）</td></tr>
                    <tr><td>可迁移应用</td><td>${(subScores.t3_1 || 0).toFixed(1)}</td><td>100%</td></tr>
                </tbody>
            </table>
        `;
    } else if (evalData.department === 'patent') {
        detailTableHtml = `
            <table class="dimension-table">
                <thead><tr><th>评估维度</th><th>得分</th><th>权重</th></tr></thead>
                <tbody>
                    <tr class="group-header"><td colspan="3">新颖性与实用性（30%）</td></tr>
                    <tr><td>授权前景</td><td>${(subScores.p1_1 || 0).toFixed(1)}</td><td>100%</td></tr>
                    <tr class="group-header"><td colspan="3">撰写空间（50%）</td></tr>
                    <tr><td>保护范围</td><td>${(subScores.p2_1 || 0).toFixed(1)}</td><td>100%</td></tr>
                    <tr class="group-header"><td colspan="3">取证难度（20%）</td></tr>
                    <tr><td>维权难易</td><td>${(subScores.p3_1 || 0).toFixed(1)}</td><td>100%</td></tr>
                </tbody>
            </table>
        `;
    }
    
    const content = `
        <div class="dept-detail-content">
            <div class="dept-detail-header">
                <div class="dept-detail-score">${score100}<span>分</span></div>
                <div class="dept-detail-info">
                    <p><strong>评估人：</strong>${evalData.evaluator}</p>
                    <p><strong>提交时间：</strong>${Utils.formatDate(evalData.submitted_at)}</p>
                </div>
            </div>
            <div class="dept-detail-table">
                ${detailTableHtml}
            </div>
        </div>
    `;
    
    document.getElementById('scoreRangeModalTitle').textContent = `📋 ${deptName}评估详情`;
    document.getElementById('scoreRangeModalContent').innerHTML = content;
    show('scoreRangeModal');
}

// ==================== 项目详情模块 ====================
function openProject(projectId) {
    currentProjectId = projectId;

    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('detailTab').classList.add('active');

    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);
    const evals = db.evaluations.filter(e => e.project_id === projectId);

    if (!project) {
        alert('项目不存在');
        backToProjects();
        return;
    }

    renderProjectDetail(project, evals);
}

function renderProjectDetail(project, evals) {
    const canManageImages = project.creator === currentUser.real_name;

    document.getElementById('detailContent').innerHTML = `
        <div class="dimension-section">
            <div class="dimension-header" onclick="toggleDimension(this)">
                <span>📝 项目信息</span>
                <span class="arrow rotate">▼</span>
            </div>
            <div class="dimension-body show">
                <h2>${escapeHtml(project.name)}</h2>
                <p style="color:#7f8c8d;line-height:1.8;margin:12px 0;">${escapeHtml(project.description) || '无描述'}</p>
                ${renderProjectImages(project, canManageImages)}
                ${renderProjectLinks(project)}
                <small style="color:#999;">创建人：${project.creator} | ${Utils.formatDate(project.created_at)}</small>
            </div>
        </div>
    `;

    // 检查当前用户是否已评分
    const myEval = evals.find(e => e.evaluator_id === currentUser.id);

    if (myEval) {
        renderSubmittedResult(myEval);
        hide('evalFormSection');
        show('submittedResult');
    } else {
        hide('submittedResult');
        renderEvalForm();
        show('evalFormSection');
    }

    // 显示其他部门评分
    renderOtherScores(evals);
}

function renderProjectImages(project, canManage) {
    if (!project.images || project.images.length === 0) {
        return canManage ? `
            <div class="image-management">
                <h4>🖼️ 图片管理</h4>
                <p style="color:#999;font-size:0.85rem;">暂无图片，可添加最多 ${CONFIG.MAX_IMAGES} 张</p>
                <input type="file" accept="image/*" multiple onchange="addProjectImages('${project.id}', this)">
            </div>
        ` : '';
    }

    let html = `
        <div class="project-images">
            ${project.images.map((img, i) => `
                <div class="project-image-container">
                    <img src="${img}" class="project-image" onclick="viewImage('${img}')" alt="图片${i + 1}">
                    ${canManage ? `<button class="image-delete-btn" onclick="event.stopPropagation();deleteProjectImage('${project.id}', ${i})" title="删除">×</button>` : ''}
                </div>
            `).join('')}
        </div>
    `;

    if (canManage && project.images.length < CONFIG.MAX_IMAGES) {
        html += `
            <div class="image-management">
                <h4>🖼️ 添加更多图片</h4>
                <p style="color:#999;font-size:0.85rem;">还可添加 ${CONFIG.MAX_IMAGES - project.images.length} 张</p>
                <input type="file" accept="image/*" multiple onchange="addProjectImages('${project.id}', this)">
            </div>
        `;
    }

    return html;
}

function renderProjectLinks(project) {
    if (!project.links || project.links.length === 0) return '';

    return `
        <div class="project-links">
            ${project.links.map(link => `
                <a href="javascript:void(0)" onclick="viewLink('${escapeHtml(link)}')" class="project-link">
                    🔗 ${escapeHtml(link)}
                </a>
            `).join('')}
        </div>
    `;
}

function renderSubmittedResult(evalData) {
    const deptName = Utils.getDeptName(currentUser.department);
    const score100 = (evalData.total_score * 20).toFixed(1);
    const score100Num = parseFloat(score100);
    const level = Utils.getLevel(score100Num);
    
    // 获取星级（基于百分制）
    const getStars = (count) => '★'.repeat(count);
    const starCount = score100Num >= 90 ? 5 : score100Num >= 80 ? 4 : score100Num >= 70 ? 3 : score100Num >= 60 ? 2 : 1;

    document.getElementById('submittedResult').innerHTML = `
        <div class="result-section">
            <h3>📊 ${Utils.formatDate(evalData.submitted_at, true)} 评估结果</h3>
            <div class="total-score">
                <div>${deptName}评定得分</div>
                <div class="total-score-value">${evalData.total_score.toFixed(2)}</div>
                <div style="font-size: 0.9rem; opacity: 0.8; margin-top: 5px;">百分制: ${score100}分</div>
                <div class="evaluation-level ${level.class}" style="cursor: pointer;" onclick="showScoreRangeModal('${score100}', '${deptName}')" title="点击查看${deptName}分数段价值参考标准"><span class="level-stars">${getStars(starCount)}</span> ${level.title}</div>
            </div>
            
            <!-- 评分说明 -->
            <div style="margin-top: 20px; text-align: left;">
                <h4 style="color: white; font-size: 1rem; margin-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 8px;">📖 评分说明</h4>
                ${generateScoreExplanation(currentUser.department, evalData.total_score)}
            </div>
            
            <!-- AI分析按钮 -->
            <div class="ai-analysis-section" style="margin-top: 25px; background: rgba(255,255,255,0.1); padding: 20px; border-radius: 12px;">
                <div class="ai-analysis-header">
                    <span class="ai-icon">🤖</span>
                    <h4 style="color: white; margin: 0;">AI 智能分析</h4>
                </div>
                <p style="color: rgba(255,255,255,0.8); font-size: 0.9rem; margin: 10px 0;">基于您的评分，AI 将提供专利撰写决策建议</p>
                <button class="ai-btn" onclick="generateAIAnalysis('${currentUser.department}', ${evalData.total_score}, '${currentProjectId}')">
                    <span>✨</span> 一键生成 AI 分析报告
                </button>
                <div id="aiResult_${currentUser.department}" style="margin-top: 15px;"></div>
            </div>
            
            <div style="margin-top:20px;text-align:center;">
                <button class="btn btn-warning" onclick="reEvaluate()">🔄 重新评估</button>
            </div>
        </div>
    `;
}

function renderOtherScores(evals) {
    const otherEvals = evals.filter(e => e.department !== currentUser.department);

    if (otherEvals.length === 0) {
        hide('otherScoresSection');
        return;
    }

    show('otherScoresSection');
    document.getElementById('otherScoresSection').innerHTML = `
        <div class="dimension-section">
            <div class="dimension-header" style="background:linear-gradient(135deg,#27ae60,#2ecc71);" onclick="toggleDimension(this)">
                <span>✅ 其他部门评估结果</span>
                <span class="arrow rotate">▼</span>
            </div>
            <div class="dimension-body show">
                <div class="party-grid">
                    ${otherEvals.map((e, index) => `
                        <div class="party-card" data-eval-index="${index}">
                            <div class="party-name">${Utils.getDeptName(e.department)} - ${e.evaluator}</div>
                            <div class="score-value">${e.total_score?.toFixed(2) || '-'}</div>
                            <div style="font-size: 0.75rem; color: rgba(255,255,255,0.8); margin-top: 4px;">百分制: ${(e.total_score * 20).toFixed(1)}分</div>
                            <div style="font-size: 0.7rem; color: rgba(255,255,255,0.6); margin-top: 2px;">${Utils.formatDate(e.submitted_at, true)}</div>
                            <button class="btn btn-secondary btn-sm" style="margin-top:8px;" onclick="showRadarModalByIndex(${index})">📋 查看详情</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
    
    // 保存当前项目的其他评估数据，供雷达图使用
    window.currentOtherEvals = otherEvals;
}

// 通过索引显示雷达图（修复ID查找问题）
function showRadarModalByIndex(index) {
    const evalData = window.currentOtherEvals?.[index];
    if (!evalData) {
        alert('评估数据不存在');
        return;
    }
    showRadarModal(evalData);
}

// 显示雷达图弹窗（支持直接传入evalData）
function showRadarModal(evalData) {
    if (!evalData) return;

    const dimensionScores = calculateDimensionScores(evalData);
    const subScores = evalData.sub_scores || {};
    
    // 如果没有维度分数，显示提示
    if (Object.keys(dimensionScores).length === 0) {
        alert('暂无评估详情数据');
        return;
    }

    // 生成详细维度分数表格
    const detailScoresHtml = generateDetailScoresTable(evalData.department, subScores);

    const score100ForModal = (evalData.total_score * 20).toFixed(1);
    const levelForModal = Utils.getLevel(parseFloat(score100ForModal));
    
    document.getElementById('radarModalTitle').textContent =
        `📊 ${Utils.getDeptName(evalData.department)} - ${evalData.evaluator} 的评估详情`;
    document.getElementById('radarModalFooter').innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
            <div>
                综合评分：<strong style="color:#3498db;font-size:18px;">${score100ForModal}</strong>分 (百分制) |
                <span class="${levelForModal.class}">${levelForModal.title}</span>
            </div>
            <div style="font-size: 0.9rem; color: #666;">
                5分制: ${evalData.total_score.toFixed(2)}
            </div>
        </div>
        ${detailScoresHtml}
    `;

    show('radarModal');

    // 绘制雷达图
    const ctx = document.getElementById('radarChart').getContext('2d');

    if (radarChartInstance) {
        radarChartInstance.destroy();
    }

    // 根据部门设置不同颜色
    const deptColors = {
        market: { bg: 'rgba(231, 76, 60, 0.2)', border: 'rgba(231, 76, 60, 1)' },
        tech: { bg: 'rgba(52, 152, 219, 0.2)', border: 'rgba(52, 152, 219, 1)' },
        patent: { bg: 'rgba(155, 89, 182, 0.2)', border: 'rgba(155, 89, 182, 1)' }
    };
    const colors = deptColors[evalData.department] || deptColors.tech;

    radarChartInstance = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: Object.keys(dimensionScores),
            datasets: [{
                label: '得分 (满分5分)',
                data: Object.values(dimensionScores),
                backgroundColor: colors.bg,
                borderColor: colors.border,
                pointBackgroundColor: colors.border,
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: colors.border,
                borderWidth: 2,
                pointRadius: 4
            }]
        },
        options: {
            scales: {
                r: {
                    angleLines: { display: true, color: 'rgba(0,0,0,0.1)' },
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    suggestedMin: 0,
                    suggestedMax: 5,
                    ticks: { 
                        stepSize: 1,
                        backdropColor: 'transparent'
                    },
                    pointLabels: {
                        font: { size: 12 }
                    }
                }
            },
            plugins: {
                legend: { 
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.raw.toFixed(2) + '分';
                        }
                    }
                }
            },
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

// 生成详细维度分数表格
function generateDetailScoresTable(department, subScores) {
    const dimensionNames = {
        market: {
            m1_1: { name: 'Top级需求', weight: '40%', group: '用户买不买单 (50%)' },
            m1_2: { name: '未被满足需求', weight: '35%', group: '用户买不买单 (50%)' },
            m1_3: { name: 'Top级痛点', weight: '25%', group: '用户买不买单 (50%)' },
            m2_1: { name: '竞争格局', weight: '40%', group: '用户愿花多少钱 (30%)' },
            m2_2: { name: '溢价能力', weight: '60%', group: '用户愿花多少钱 (30%)' },
            m3_1: { name: '市场规模', weight: '50%', group: '市场规模与增长 (20%)' },
            m3_2: { name: '成长性', weight: '50%', group: '市场规模与增长 (20%)' }
        },
        tech: {
            t1_1: { name: '创新程度', weight: '100%', group: '创新程度 (40%)' },
            t2_1: { name: '竞争优势', weight: '100%', group: '竞争优势 (30%)' },
            t3_1: { name: '可扩展性', weight: '100%', group: '可扩展性 (30%)' }
        },
        patent: {
            p1_1: { name: '新颖性与实用性', weight: '100%', group: '新颖性与实用性 (30%)' },
            p2_1: { name: '撰写空间', weight: '100%', group: '撰写空间 (50%)' },
            p3_1: { name: '取证难度', weight: '100%', group: '取证难度 (20%)' }
        }
    };

    const names = dimensionNames[department];
    if (!names) return '';

    let html = '<div style="margin-top: 20px; text-align: left;">';
    html += '<h4 style="color: #2c3e50; margin-bottom: 15px; font-size: 1rem;">📋 各维度详细得分</h4>';
    html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">';
    html += '<thead><tr style="background: #f8f9fa;"><th style="padding: 10px; border: 1px solid #dee2e6; text-align: left;">评估维度</th><th style="padding: 10px; border: 1px solid #dee2e6; text-align: center;">权重</th><th style="padding: 10px; border: 1px solid #dee2e6; text-align: center;">得分</th><th style="padding: 10px; border: 1px solid #dee2e6; text-align: center;">百分制</th></tr></thead>';
    html += '<tbody>';

    let currentGroup = '';
    Object.entries(names).forEach(([key, info]) => {
        const score = subScores[key] || 0;
        const score100 = (score * 20).toFixed(1);
        
        if (info.group !== currentGroup) {
            currentGroup = info.group;
            html += `<tr style="background: #e9ecef;"><td colspan="4" style="padding: 8px 10px; border: 1px solid #dee2e6; font-weight: 600; color: #495057;">${info.group}</td></tr>`;
        }
        
        html += `<tr>
            <td style="padding: 10px; border: 1px solid #dee2e6;">${info.name}</td>
            <td style="padding: 10px; border: 1px solid #dee2e6; text-align: center;">${info.weight}</td>
            <td style="padding: 10px; border: 1px solid #dee2e6; text-align: center; font-weight: 600;">${score.toFixed(1)}</td>
            <td style="padding: 10px; border: 1px solid #dee2e6; text-align: center; color: #666;">${score100}分</td>
        </tr>`;
    });

    html += '</tbody></table></div>';
    return html;
}

// ==================== 评分说明生成 ====================
function generateScoreExplanation(department, score5) {
    const score100 = score5 * 20;
    
    // 根据百分制分数确定等级和说明
    let level, title, explanation, suggestion;
    
    if (score100 >= 90) {
        level = 'excellent';
        title = '极具价值';
        explanation = '该技术方案在各项评估维度均表现优异，具有很强的市场竞争力和技术创新性。';
        suggestion = '建议立即启动专利申请流程，并考虑PCT国际布局以扩大保护范围。';
    } else if (score100 >= 80) {
        level = 'good';
        title = '高价值';
        explanation = '该技术方案整体表现良好，具备申请专利的基本条件，个别维度有提升空间。';
        suggestion = '建议在完善部分薄弱环节后提交专利申请，重点关注评分较低的维度。';
    } else if (score100 >= 70) {
        level = 'average';
        title = '中等偏上价值';
        explanation = '该技术方案具有一定价值，但存在明显短板，需要针对性改进。';
        suggestion = '建议先进行技术优化，待评分提升后再申请专利，或先申请实用新型专利。';
    } else if (score100 >= 60) {
        level = 'caution';
        title = '中等价值';
        explanation = '该技术方案价值一般，专利授权概率和保护价值均存在不确定性。';
        suggestion = '建议深入评估技术改进的可行性和商业回报，谨慎决定是否投入专利申请资源。';
    } else {
        level = 'poor';
        title = '低价值';
        explanation = '该技术方案在市场需求、技术创新性或可专利性方面存在明显不足。';
        suggestion = '不建议投入资源申请专利，建议考虑其他保护方式或重新评估项目方向。';
    }
    
    // 根据部门添加特定说明
    const deptSpecific = {
        market: {
            excellent: '市场需求强劲，商业价值突出，用户购买意愿强烈。',
            good: '市场需求良好，具有一定的商业价值和溢价能力。',
            average: '市场需求一般，需要进一步调研和优化产品定位。',
            caution: '市场需求存疑，商业化前景不确定。',
            poor: '市场需求不足，可能非用户核心痛点。'
        },
        tech: {
            excellent: '技术创新性强，具有核心竞争力和颠覆性突破潜力。',
            good: '技术创新性良好，相比竞品具有明显优势。',
            average: '技术创新性一般，存在一定竞争力但优势不明显。',
            caution: '技术创新性有限，可能为常规改进。',
            poor: '技术创新性不足，缺乏核心竞争力。'
        },
        patent: {
            excellent: '可专利性良好，新颖性和创造性高，授权前景乐观。',
            good: '可专利性较好，撰写空间充足，保护范围可期。',
            average: '可专利性一般，需要进一步完善技术方案。',
            caution: '可专利性存疑，新颖性和创造性可能不足。',
            poor: '可专利性较低，授权风险较高，建议考虑其他保护方式。'
        }
    };
    
    const deptNote = deptSpecific[department]?.[level] || '';

    return `
        <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-top: 10px;">
            <p style="color: rgba(255,255,255,0.9); line-height: 1.7; margin: 0 0 10px 0;">${explanation}</p>
            <p style="color: rgba(255,255,255,0.85); line-height: 1.7; margin: 0 0 10px 0; font-size: 0.9rem;"><strong>部门评估：</strong>${deptNote}</p>
            <p style="color: rgba(255,255,255,0.85); line-height: 1.7; margin: 0; font-size: 0.9rem;"><strong>建议：</strong>${suggestion}</p>
        </div>
    `;
}

// ==================== AI 智能分析 ====================
async function generateAIAnalysis(department, score, projectId) {
    const resultContainer = document.getElementById(`aiResult_${department}`);
    
    // 显示加载状态
    resultContainer.innerHTML = `
        <div class="ai-loading">
            <div class="ai-spinner"></div>
            <span>AI 正在分析中，请稍候...</span>
        </div>
    `;

    // 获取项目信息
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);
    const myEval = db.evaluations.find(e => e.project_id === projectId && e.department === department && e.evaluator_id === currentUser.id);

    // 构建 AI 分析提示
    const prompt = buildAIPrompt(department, score, project, myEval?.sub_scores);

    try {
        // 调用 AI 分析（这里使用模拟的 AI 响应，实际可以接入 Kimi API）
        const analysis = await mockAIAnalysis(prompt, department, score);
        
        resultContainer.innerHTML = `
            <div class="ai-result">
                <h5>🎯 AI 专利撰写决策建议</h5>
                <div class="ai-result-content">${analysis}</div>
            </div>
        `;
    } catch (error) {
        resultContainer.innerHTML = `
            <div class="ai-result" style="border-left-color: var(--danger);">
                <h5>❌ 分析失败</h5>
                <div class="ai-result-content">${error.message || 'AI 分析服务暂时不可用，请稍后重试。'}</div>
            </div>
        `;
    }
}

function buildAIPrompt(department, score, project, subScores) {
    const deptName = Utils.getDeptName(department);
    const score100 = (score * 20).toFixed(1);
    
    let subScoreDetails = '';
    if (subScores) {
        Object.entries(subScores).forEach(([key, value]) => {
            const standard = RatingStandards[department]?.[key];
            if (standard) {
                subScoreDetails += `- ${standard.title}: ${value}分\n`;
            }
        });
    }

    return `请作为专利评估专家，基于以下${deptName}评估结果，提供详细的专利撰写决策建议：

项目: ${project?.name || '未命名项目'}
总评分: ${score.toFixed(2)}分 (百分制: ${score100}分)

详细评分:
${subScoreDetails}

请提供以下方面的建议：
1. 是否建议申请专利
2. 专利申请的类型建议（发明/实用新型/外观）
3. 专利撰写的重点和注意事项
4. 权利要求书的布局建议
5. 可能面临的审查风险及应对策略`;
}

async function mockAIAnalysis(prompt, department, score) {
    // 模拟 AI 分析延迟
    await new Promise(resolve => setTimeout(resolve, 1500));

    const score100 = score * 20;
    const deptName = Utils.getDeptName(department);

    // 根据分数生成不同的分析建议
    if (score100 >= 80) {
        return `
            <h6 style="color: #27ae60; margin: 12px 0 8px 0;">✅ 强烈建议申请专利</h6>
            <p><strong>1. 专利申请建议：</strong>建议立即申请发明专利，该技术方案在${deptName}评估中表现优秀，具有较高的创新价值和市场前景。</p>
            
            <h6 style="color: var(--primary); margin: 12px 0 8px 0;">📝 撰写重点</h6>
            <ul style="margin: 8px 0; padding-left: 20px;">
                <li>权利要求书应采用"金字塔"式布局，从宽到窄构建保护层次</li>
                <li>说明书应详细描述技术方案的创新点和实施方式</li>
                <li>附图应清晰展示技术方案的结构和工作原理</li>
            </ul>
            
            <h6 style="color: var(--primary); margin: 12px 0 8px 0;">⚠️ 风险提示</h6>
            <p>虽然评分较高，但仍需注意：充分检索现有技术，确保权利要求的创造性；注意技术方案的充分公开，避免因公开不充分导致驳回。</p>
            
            <div style="background: #e8f5e9; padding: 12px; border-radius: 6px; margin-top: 12px;">
                <strong>💡 决策建议：</strong>该技术方案值得投入资源进行专利申请，预计授权概率较高。
            </div>
        `;
    } else if (score100 >= 60) {
        return `
            <h6 style="color: #f39c12; margin: 12px 0 8px 0;">⚠️ 建议完善后申请</h6>
            <p><strong>1. 专利申请建议：</strong>该技术方案具有一定价值，但建议在完善后再申请专利。可以考虑先申请实用新型专利进行快速保护。</p>
            
            <h6 style="color: var(--primary); margin: 12px 0 8px 0;">📝 改进建议</h6>
            <ul style="margin: 8px 0; padding-left: 20px;">
                <li>进一步完善技术方案的创新点</li>
                <li>补充更多的实施例和技术细节</li>
                <li>考虑技术方案的替代实现方式</li>
            </ul>
            
            <h6 style="color: var(--primary); margin: 12px 0 8px 0;">⚠️ 风险提示</h6>
            <p>当前评分处于中等水平，可能面临创造性审查的挑战。建议加强技术方案的差异化设计，提高授权概率。</p>
            
            <div style="background: #fff8e1; padding: 12px; border-radius: 6px; margin-top: 12px;">
                <strong>💡 决策建议：</strong>可以继续申请专利，但建议先进行技术方案的优化和完善。
            </div>
        `;
    } else {
        return `
            <h6 style="color: #e74c3c; margin: 12px 0 8px 0;">❌ 不建议申请专利</h6>
            <p><strong>1. 专利申请建议：</strong>基于当前评估结果，该技术方案的专利价值较低，不建议投入资源申请专利。</p>
            
            <h6 style="color: var(--primary); margin: 12px 0 8px 0;">📝 替代方案</h6>
            <ul style="margin: 8px 0; padding-left: 20px;">
                <li>考虑作为技术秘密保护</li>
                <li>重新评估技术路线的可行性</li>
                <li>寻找更具创新性的技术方向</li>
            </ul>
            
            <h6 style="color: var(--primary); margin: 12px 0 8px 0;">⚠️ 风险提示</h6>
            <p>当前技术方案可能缺乏足够的创新性和市场竞争力，申请专利的成功率较低，且保护价值有限。</p>
            
            <div style="background: #ffebee; padding: 12px; border-radius: 6px; margin-top: 12px;">
                <strong>💡 决策建议：</strong>建议重新评估该技术方案的商业价值，考虑其他保护方式或技术方向。
            </div>
        `;
    }
}

// ==================== 评估表单模块 ====================
function renderEvalForm() {
    const dept = currentUser.department;
    const forms = {
        market: `
            <div class="dimension-section">
                <div class="dimension-header" onclick="toggleDimension(this)">
                    <span>🎯 市场价值 (40%)</span>
                    <span class="arrow rotate">▼</span>
                </div>
                <div class="dimension-body show">
                    <div class="core-point">
                        <div class="core-point-title">【核心点 1】用户买不买单？(50%)</div>
                        ${renderRating('m1_1', '是否属于 Top 级需求？', '40%')}
                        ${renderRating('m1_2', '是否未被满足？', '35%')}
                        ${renderRating('m1_3', '是否 Top 级痛点？', '25%')}
                    </div>
                    <div class="core-point">
                        <div class="core-point-title">【核心点 2】用户愿花多少钱？(30%)</div>
                        ${renderRating('m2_1', '竞争格局？', '40%')}
                        ${renderRating('m2_2', '溢价能力？', '60%')}
                    </div>
                    <div class="core-point">
                        <div class="core-point-title">【核心点 3】市场规模与增长 (20%)</div>
                        ${renderRating('m3_1', '市场规模？', '50%')}
                        ${renderRating('m3_2', '成长性？', '50%')}
                    </div>
                    <button class="btn btn-primary" onclick="submitEvaluation('market')">提交评估</button>
                </div>
            </div>
        `,
        tech: `
            <div class="dimension-section">
                <div class="dimension-header" onclick="toggleDimension(this)">
                    <span>🔬 技术价值 (40%)</span>
                    <span class="arrow rotate">▼</span>
                </div>
                <div class="dimension-body show">
                    <div class="core-point">
                        <div class="core-point-title">【核心点 1】创新程度 (40%)</div>
                        ${renderRating('t1_1', '创新程度？', '100%')}
                    </div>
                    <div class="core-point">
                        <div class="core-point-title">【核心点 2】竞争优势 (30%)</div>
                        ${renderRating('t2_1', '相比竞品优势？', '100%')}
                    </div>
                    <div class="core-point">
                        <div class="core-point-title">【核心点 3】可扩展性 (30%)</div>
                        ${renderRating('t3_1', '可迁移应用？', '100%')}
                    </div>
                    <button class="btn btn-primary" onclick="submitEvaluation('tech')">提交评估</button>
                </div>
            </div>
        `,
        patent: `
            <div class="dimension-section">
                <div class="dimension-header" onclick="toggleDimension(this)">
                    <span>⚖️ 可专利性 (20%)</span>
                    <span class="arrow rotate">▼</span>
                </div>
                <div class="dimension-body show">
                    <div class="core-point">
                        <div class="core-point-title">【核心点 1】新颖性与实用性 (30%)</div>
                        ${renderRating('p1_1', '授权前景？', '100%')}
                    </div>
                    <div class="core-point">
                        <div class="core-point-title">【核心点 2】撰写空间 (50%)</div>
                        ${renderRating('p2_1', '保护范围？', '100%')}
                    </div>
                    <div class="core-point">
                        <div class="core-point-title">【核心点 3】取证难度 (20%)</div>
                        ${renderRating('p3_1', '维权难易？', '100%')}
                    </div>
                    <button class="btn btn-primary" onclick="submitEvaluation('patent')">提交评估</button>
                </div>
            </div>
        `
    };

    document.getElementById('evalFormSection').innerHTML = `
        <div class="info-box">
            <p><strong>请填写评估</strong> 提交后其他部门可见。每个评分项下方都有详细的评分标准参考。</p>
        </div>
        ${forms[dept] || ''}
    `;
}

// 滑动条评分数据存储
const sliderValues = {};

function renderRating(name, question, weight) {
    const dept = currentUser.department;
    const standards = RatingStandards[dept]?.[name]?.standards || [];

    let standardsHtml = '';
    if (standards.length > 0) {
        standardsHtml = `
            <div class="standard-ref">
                <h5>📖 评分标准参考</h5>
                <ul>
                    ${standards.map(s => `
                        <li><strong>${s.score}分（${s.title}）</strong>：${s.desc}</li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    // 初始化滑动条值（默认为0）
    sliderValues[name] = 0;

    return `
        <div class="rating-item" data-id="${name}" data-weight="${weight}">
            <div class="rating-question">${question} <small>(${weight})</small></div>
            <div class="slider-container">
                <div class="slider-wrapper">
                    <div class="slider-track" id="track_${name}" onclick="handleTrackClick(event, '${name}')">
                        <div class="slider-fill" id="fill_${name}" style="width: 0%"></div>
                        <div class="slider-thumb" id="thumb_${name}" style="left: 0%" 
                             onmousedown="startDrag(event, '${name}')" 
                             ontouchstart="startDrag(event, '${name}')"></div>
                    </div>
                    <div class="slider-value" id="value_${name}">0.0</div>
                </div>
                <div class="slider-marks">
                    <span>0</span>
                    <span>1</span>
                    <span>2</span>
                    <span>3</span>
                    <span>4</span>
                    <span>5</span>
                </div>
            </div>
            <input type="hidden" name="${name}" id="input_${name}" value="0">
            ${standardsHtml}
        </div>
    `;
}

// 滑动条拖动功能
let isDragging = false;
let currentSlider = null;

function startDrag(event, name) {
    isDragging = true;
    currentSlider = name;
    event.preventDefault();
    
    document.addEventListener('mousemove', handleDrag);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchmove', handleDrag, { passive: false });
    document.addEventListener('touchend', stopDrag);
}

function handleDrag(event) {
    if (!isDragging || !currentSlider) return;
    event.preventDefault();
    
    const track = document.getElementById(`track_${currentSlider}`);
    const rect = track.getBoundingClientRect();
    
    let clientX;
    if (event.type === 'touchmove') {
        clientX = event.touches[0].clientX;
    } else {
        clientX = event.clientX;
    }
    
    let percentage = (clientX - rect.left) / rect.width;
    percentage = Math.max(0, Math.min(1, percentage));
    
    updateSlider(currentSlider, percentage);
}

function stopDrag() {
    isDragging = false;
    currentSlider = null;
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchmove', handleDrag);
    document.removeEventListener('touchend', stopDrag);
}

function handleTrackClick(event, name) {
    if (event.target.classList.contains('slider-thumb')) return;
    
    const track = document.getElementById(`track_${name}`);
    const rect = track.getBoundingClientRect();
    let percentage = (event.clientX - rect.left) / rect.width;
    percentage = Math.max(0, Math.min(1, percentage));
    
    updateSlider(name, percentage);
}

function updateSlider(name, percentage) {
    const value = (percentage * 5).toFixed(1);
    sliderValues[name] = parseFloat(value);
    
    const fill = document.getElementById(`fill_${name}`);
    const thumb = document.getElementById(`thumb_${name}`);
    const valueDisplay = document.getElementById(`value_${name}`);
    const input = document.getElementById(`input_${name}`);
    
    if (fill) fill.style.width = `${percentage * 100}%`;
    if (thumb) thumb.style.left = `${percentage * 100}%`;
    if (valueDisplay) valueDisplay.textContent = value;
    if (input) input.value = value;
}

// ==================== 评分计算模块 ====================
function calcScore() {
    const getVal = name => sliderValues[name] !== undefined ? sliderValues[name] : 2.5;

    if (currentUser.department === 'market') {
        const c1 = getVal('m1_1') * 0.4 + getVal('m1_2') * 0.35 + getVal('m1_3') * 0.25;
        const c2 = getVal('m2_1') * 0.4 + getVal('m2_2') * 0.6;
        const c3 = (getVal('m3_1') + getVal('m3_2')) / 2;
        return c1 * 0.5 + c2 * 0.3 + c3 * 0.2;
    }

    if (currentUser.department === 'tech') {
        return getVal('t1_1') * 0.4 + getVal('t2_1') * 0.3 + getVal('t3_1') * 0.3;
    }

    if (currentUser.department === 'patent') {
        return getVal('p1_1') * 0.3 + getVal('p2_1') * 0.5 + getVal('p3_1') * 0.2;
    }

    return 0;
}

async function submitEvaluation(department) {
    const ratings = document.querySelectorAll('#evalFormSection .rating-item');
    
    // 滑动条模式下所有项都有默认值，无需检查
    const totalScore = calcScore();

    // 收集子评分
    const subScores = {};
    ratings.forEach(r => {
        const name = r.dataset.id;
        subScores[name] = sliderValues[name] || 2.5;
    });

    const db = DataStore.getDB();

    // 检查是否已存在评分
    const existingEval = db.evaluations.find(e =>
        e.project_id === currentProjectId &&
        e.department === department &&
        e.evaluator_id === currentUser.id
    );

    // 如果已存在，先删除旧评分
    if (existingEval) {
        await DataStore.deleteEvaluation(existingEval.id);
    }

    const evalData = {
        id: Utils.generateId(),
        project_id: currentProjectId,
        evaluator_id: currentUser.id,
        evaluator: currentUser.real_name,
        department,
        total_score: totalScore,
        sub_scores: subScores,
        submitted_at: new Date().toISOString()
    };

    await DataStore.createEvaluation(evalData);
    alert('评估提交成功！');
    openProject(currentProjectId);
}

async function reEvaluate() {
    if (!confirm('确定要重新评估该项目吗？\n\n新评估将覆盖之前的评分结果。')) {
        return;
    }

    const db = DataStore.getDB();
    const existingEval = db.evaluations.find(e =>
        e.project_id === currentProjectId &&
        e.evaluator_id === currentUser.id
    );

    if (existingEval) {
        await DataStore.deleteEvaluation(existingEval.id);
    }

    hide('submittedResult');
    renderEvalForm();
    show('evalFormSection');
}

// ==================== 历史记录模块 ====================
function loadHistory() {
    const db = DataStore.getDB();
    const list = document.getElementById('historyList');
    const searchTerm = document.getElementById('historySearch')?.value.toLowerCase() || '';

    let evaluations = [...db.evaluations];

    if (searchTerm) {
        evaluations = evaluations.filter(e => {
            const project = db.projects.find(p => p.id === e.project_id);
            return project?.name.toLowerCase().includes(searchTerm) ||
                   e.evaluator.toLowerCase().includes(searchTerm);
        });
    }

    evaluations.sort((a, b) => b.submitted_at - a.submitted_at);

    if (evaluations.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <p>暂无评估记录</p>
            </div>
        `;
        return;
    }

    list.innerHTML = evaluations.map(e => {
        const project = db.projects.find(p => p.id === e.project_id);
        const score100 = (e.total_score * 20).toFixed(1);
        const level = Utils.getLevel(parseFloat(score100));

        return `
            <div class="project-card" onclick="openProject('${e.project_id}')">
                <div class="project-title">${escapeHtml(project?.name || '未知项目')}</div>
                <div class="project-meta">${Utils.getDeptName(e.department)} - ${e.evaluator} | ${Utils.formatDate(e.submitted_at)}</div>
                <div class="score-grid">
                    <div class="score-item">
                        <div class="score-label">评分(100)</div>
                        <div class="score-value">${score100}</div>
                        <div style="font-size:0.7rem;color:#95a5a6;">5分制:${e.total_score.toFixed(2)}</div>
                    </div>
                    <div class="score-item">
                        <div class="score-label">等级</div>
                        <div style="font-size:0.85rem;color:#666;">${level.title}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function filterHistory() {
    loadHistory();
}

// ==================== 图片管理功能 ====================
async function addProjectImages(projectId, input) {
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);

    if (!project) {
        alert('项目不存在');
        return;
    }

    if (project.creator !== currentUser.real_name) {
        alert('只有项目创建者才能管理图片');
        return;
    }

    const files = Array.from(input.files);
    const currentCount = project.images?.length || 0;
    const availableSlots = CONFIG.MAX_IMAGES - currentCount;

    if (files.length > availableSlots) {
        alert(`当前还可上传 ${availableSlots} 张图片`);
        input.value = '';
        return;
    }

    const newImages = [];
    for (const file of files) {
        const validation = Utils.validateImage(file);
        if (!validation.valid) {
            alert(`${file.name}: ${validation.error}`);
            continue;
        }

        try {
            const base64 = await Utils.readFileAsBase64(file);
            newImages.push(base64);
        } catch (e) {
            alert(`读取 ${file.name} 失败`);
        }
    }

    if (newImages.length > 0) {
        const currentImages = project.images || [];
        const updates = {
            images: [...currentImages, ...newImages],
            updated_at: Date.now()
        };

        await DataStore.updateProject(projectId, updates);
        alert(`✅ 成功添加 ${newImages.length} 张图片`);
        openProject(projectId);
    }

    input.value = '';
}

async function deleteProjectImage(projectId, imageIndex) {
    if (!confirm('确定要删除这张图片吗？')) return;

    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);

    if (!project || !project.images) return;

    if (project.creator !== currentUser.real_name) {
        alert('只有项目创建者才能删除图片');
        return;
    }

    const newImages = [...project.images];
    newImages.splice(imageIndex, 1);
    
    await DataStore.updateProject(projectId, {
        images: newImages,
        updated_at: Date.now()
    });
    
    alert('图片已删除');
    openProject(projectId);
}

// ==================== 图片查看器 ====================
function viewImage(src) {
    document.getElementById('imageViewerImg').src = src;
    show('imageViewerModal');
}

function closeImageViewer() {
    hide('imageViewerModal');
}

function viewLink(url) {
    if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url)) {
        viewImage(url);
    } else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}

function calculateDimensionScores(evalData) {
    const subScores = evalData.sub_scores || {};

    if (evalData.department === 'market') {
        return {
            '用户买不买单': (subScores['m1_1'] || 3) * 0.4 + (subScores['m1_2'] || 3) * 0.35 + (subScores['m1_3'] || 3) * 0.25,
            '用户愿花多少钱': (subScores['m2_1'] || 3) * 0.4 + (subScores['m2_2'] || 3) * 0.6,
            '市场规模与增长': ((subScores['m3_1'] || 3) + (subScores['m3_2'] || 3)) / 2
        };
    }

    if (evalData.department === 'tech') {
        return {
            '创新程度': subScores['t1_1'] || 3,
            '竞争优势': subScores['t2_1'] || 3,
            '可扩展性': subScores['t3_1'] || 3
        };
    }

    if (evalData.department === 'patent') {
        return {
            '新颖性': subScores['p1_1'] || 3,
            '撰写空间': subScores['p2_1'] || 3,
            '取证难度': subScores['p3_1'] || 3
        };
    }

    return {};
}

function closeRadarModal() {
    hide('radarModal');
}

// ==================== 指导建议模块 ====================
function showGuideModal(projectId) {
    window.currentGuideProjectId = projectId;
    const content = generateTotalGuide(projectId);
    document.getElementById('guideModalContent').innerHTML = content;
    show('guideModal');
}

// 显示AI分析报告弹窗
function showAIAnalysisModal(projectId) {
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);
    const evals = db.evaluations.filter(e => e.project_id === projectId);
    
    const marketEval = evals.find(e => e.department === 'market');
    const techEval = evals.find(e => e.department === 'tech');
    const patentEval = evals.find(e => e.department === 'patent');
    
    if (!marketEval || !techEval || !patentEval) {
        alert('请等待三端评估完成后再查看AI分析报告');
        return;
    }
    
    const totalScore5 = ((marketEval.total_score + techEval.total_score + patentEval.total_score) / 3);
    const totalScore100 = (totalScore5 * 20).toFixed(1);
    
    // 生成AI分析报告内容
    const aiReportHTML = generateAIReportHTML(project, marketEval, techEval, patentEval, totalScore100);
    
    document.getElementById('aiReportContent').innerHTML = aiReportHTML;
    document.getElementById('aiReportModalTitle').textContent = '🤖 AI 智能分析报告 - ' + project.name;
    show('aiReportModal');
}

// 生成指导建议页面的AI分析报告
async function generateGuideAIAnalysis(projectId) {
    const aiContainer = document.getElementById('guideAIAnalysis');
    if (!aiContainer) return;
    
    // 显示加载状态
    aiContainer.innerHTML = `
        <div class="ai-loading" style="padding: 30px; text-align: center;">
            <div class="ai-spinner" style="margin: 0 auto 15px;"></div>
            <span style="color: #666;">AI 正在综合分析中，请稍候...</span>
        </div>
    `;
    
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);
    const evals = db.evaluations.filter(e => e.project_id === projectId);
    
    const marketEval = evals.find(e => e.department === 'market');
    const techEval = evals.find(e => e.department === 'tech');
    const patentEval = evals.find(e => e.department === 'patent');
    
    if (!marketEval || !techEval || !patentEval) {
        aiContainer.innerHTML = '<p style="color: #999; text-align: center;">等待三端评估完成后生成AI分析报告</p>';
        return;
    }
    
    // 模拟AI分析延迟
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const totalScore5 = ((marketEval.total_score + techEval.total_score + patentEval.total_score) / 3);
    const totalScore100 = (totalScore5 * 20).toFixed(1);
    
    // 生成AI分析报告
    const analysis = generateComprehensiveAIReport(project, marketEval, techEval, patentEval, totalScore100);
    
    aiContainer.innerHTML = analysis;
}

// 生成综合AI分析报告
function generateComprehensiveAIReport(project, marketEval, techEval, patentEval, totalScore100) {
    const score = parseFloat(totalScore100);
    
    // 分析各维度强弱
    const marketScore = marketEval.total_score * 20;
    const techScore = techEval.total_score * 20;
    const patentScore = patentEval.total_score * 20;
    
    const mSub = marketEval.sub_scores || {};
    const tSub = techEval.sub_scores || {};
    const pSub = patentEval.sub_scores || {};
    
    // 找出强项和弱项
    const strengths = [];
    const weaknesses = [];
    
    if (marketScore >= 80) strengths.push(`市场端评分${marketScore.toFixed(1)}分，市场需求和商业价值良好`);
    else if (marketScore < 60) weaknesses.push(`市场端评分${marketScore.toFixed(1)}分，需重新评估市场需求`);
    
    if (techScore >= 80) strengths.push(`研发端评分${techScore.toFixed(1)}分，技术创新性较强`);
    else if (techScore < 60) weaknesses.push(`研发端评分${techScore.toFixed(1)}分，技术竞争力不足`);
    
    if (patentScore >= 80) strengths.push(`专利端评分${patentScore.toFixed(1)}分，可专利性良好`);
    else if (patentScore < 60) weaknesses.push(`专利端评分${patentScore.toFixed(1)}分，专利保护前景有限`);
    
    // 根据总分生成建议
    let decision, patentStrategy, riskAnalysis, actionPlan;
    
    if (score >= 90) {
        decision = '✅ <strong style="color: #27ae60;">强烈推荐申请专利</strong>';
        patentStrategy = '建议立即申请发明专利，并考虑PCT国际专利申请。该技术方案在三个维度均表现优秀，具有较高的市场价值和技术壁垒。';
        riskAnalysis = '风险较低。建议充分检索现有技术，确保权利要求的创造性。';
        actionPlan = '1. 立即启动专利申请流程<br>2. 准备详细的专利申请材料<br>3. 考虑国际专利布局<br>4. 同步推进产品化落地';
    } else if (score >= 80) {
        decision = '✅ <strong style="color: #3498db;">建议申请专利</strong>';
        patentStrategy = '建议申请发明专利。该技术方案整体价值较高，但需针对薄弱环节进行优化。';
        riskAnalysis = '风险可控。建议重点关注评分较低的维度，完善技术方案。';
        actionPlan = '1. 针对薄弱环节进行技术优化<br>2. 完善专利申请材料<br>3. 加强现有技术检索<br>4. 制定专利布局策略';
    } else if (score >= 70) {
        decision = '⚠️ <strong style="color: #f39c12;">建议完善后申请</strong>';
        patentStrategy = '建议先进行技术方案的优化和完善，再申请专利。可考虑先申请实用新型专利进行快速保护。';
        riskAnalysis = '存在一定风险。专利授权概率中等，需针对性改进。';
        actionPlan = '1. 分析各维度薄弱环节<br>2. 制定技术改进方案<br>3. 完善后重新评估<br>4. 考虑实用新型专利先行';
    } else if (score >= 60) {
        decision = '❓ <strong style="color: #e67e22;">谨慎评估</strong>';
        patentStrategy = '建议谨慎评估专利申请的必要性。该技术方案价值一般，需大幅改进才能提升专利价值。';
        riskAnalysis = '风险较高。专利授权概率较低，保护价值有限。';
        actionPlan = '1. 深入分析低分原因<br>2. 评估技术改进可行性<br>3. 考虑技术秘密保护<br>4. 设定明确的止损点';
    } else {
        decision = '❌ <strong style="color: #e74c3c;">不建议申请专利</strong>';
        patentStrategy = '不建议申请专利。该技术方案在多个维度表现不佳，专利价值较低。';
        riskAnalysis = '风险很高。专利授权概率很低，投入产出比不佳。';
        actionPlan = '1. 考虑技术秘密保护方式<br>2. 评估技术路线调整<br>3. 重新定位目标市场<br>4. 必要时终止项目';
    }
    
    return `
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; border-radius: 12px; color: white; margin-bottom: 20px;">
            <h4 style="margin-bottom: 15px; font-size: 1.2rem;">🤖 AI 专利撰写决策建议</h4>
            <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                <h5 style="margin: 0 0 10px 0; font-size: 1rem;">📊 综合评估结论</h5>
                <p style="margin: 0; line-height: 1.6; font-size: 1.1rem;">${decision}</p>
                <p style="margin: 10px 0 0 0; line-height: 1.6; opacity: 0.95;">综合评分: <strong>${totalScore100}分</strong> (百分制)</p>
            </div>
        </div>
        
        <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
            <h4 style="color: #2c3e50; margin-bottom: 15px;">📋 方案信息</h4>
            <p style="margin: 5px 0;"><strong>方案名称：</strong>${escapeHtml(project.name)}</p>
            <p style="margin: 5px 0;"><strong>方案描述：</strong>${escapeHtml(project.description || '暂无描述')}</p>
            ${project.images && project.images.length > 0 ? `<p style="margin: 5px 0;"><strong>技术方案图片：</strong>共 ${project.images.length} 张</p>` : ''}
        </div>
        
        <div style="background: #e8f5e9; padding: 20px; border-radius: 12px; margin-bottom: 20px; border-left: 4px solid #27ae60;">
            <h4 style="color: #27ae60; margin-bottom: 15px;">💪 优势分析</h4>
            ${strengths.length > 0 ? strengths.map(s => `<p style="margin: 8px 0; color: #333;">✓ ${s}</p>`).join('') : '<p style="color: #666;">暂无显著优势</p>'}
        </div>
        
        <div style="background: #ffebee; padding: 20px; border-radius: 12px; margin-bottom: 20px; border-left: 4px solid #e74c3c;">
            <h4 style="color: #e74c3c; margin-bottom: 15px;">⚠️ 待改进项</h4>
            ${weaknesses.length > 0 ? weaknesses.map(w => `<p style="margin: 8px 0; color: #333;">✗ ${w}</p>`).join('') : '<p style="color: #666;">暂无显著弱项</p>'}
        </div>
        
        <div style="background: #e3f2fd; padding: 20px; border-radius: 12px; margin-bottom: 20px; border-left: 4px solid #2196f3;">
            <h4 style="color: #2196f3; margin-bottom: 15px;">📝 专利策略建议</h4>
            <p style="margin: 8px 0; color: #333; line-height: 1.6;">${patentStrategy}</p>
        </div>
        
        <div style="background: #fff3e0; padding: 20px; border-radius: 12px; margin-bottom: 20px; border-left: 4px solid #ff9800;">
            <h4 style="color: #ff9800; margin-bottom: 15px;">⚡ 风险分析</h4>
            <p style="margin: 8px 0; color: #333; line-height: 1.6;">${riskAnalysis}</p>
        </div>
        
        <div style="background: #f3e5f5; padding: 20px; border-radius: 12px; border-left: 4px solid #9c27b0;">
            <h4 style="color: #9c27b0; margin-bottom: 15px;">🎯 行动计划</h4>
            <p style="margin: 8px 0; color: #333; line-height: 1.8;">${actionPlan}</p>
        </div>
    `;
}

function closeGuideModal() {
    hide('guideModal');
}

function generateTotalGuide(projectId) {
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);
    const evals = db.evaluations.filter(e => e.project_id === projectId);

    const marketEval = evals.find(e => e.department === 'market');
    const techEval = evals.find(e => e.department === 'tech');
    const patentEval = evals.find(e => e.department === 'patent');

    if (!marketEval || !techEval || !patentEval) {
        return '<div style="color:#f39c12;text-align:center;padding:40px;">⚠️ 三端评估未完成，无法生成指导建议</div>';
    }

    // 计算5分制和100分制分数
    const totalScore5 = ((marketEval.total_score + techEval.total_score + patentEval.total_score) / 3);
    const totalScore100 = (totalScore5 * 20).toFixed(1);
    const level = Utils.getLevel(totalScore5);

    const mScore5 = marketEval.total_score.toFixed(2);
    const tScore5 = techEval.total_score.toFixed(2);
    const pScore5 = patentEval.total_score.toFixed(2);
    const mScore100 = (marketEval.total_score * 20).toFixed(1);
    const tScore100 = (techEval.total_score * 20).toFixed(1);
    const pScore100 = (patentEval.total_score * 20).toFixed(1);

    const suggestions = generateSuggestions(mScore5, tScore5, pScore5);
    const scoreRangeGuide = generateScoreRangeGuide(totalScore100);
    
    // 生成各维度详细分数表格
    const dimensionScoresHTML = generateAllDimensionScoresTable(marketEval, techEval, patentEval);

    return `
        <div style="background:#f8f9fa;padding:20px;border-radius:12px;margin-bottom:20px;">
            <h4 style="color:#2c3e50;margin-bottom:15px;">📊 综合评分概况（100分制）</h4>
            
            <!-- 100分制总分展示 -->
            <div class="score-100-container" style="margin-bottom: 20px;">
                <div class="score-100-value">${totalScore100}</div>
                <div class="score-100-label">综合评分（满分100）</div>
                <div class="evaluation-level ${level.class}" style="margin-top: 15px; display: inline-block;">${level.title}</div>
            </div>
            
            <!-- 三端评分详情 -->
            <div class="score-breakdown">
                <div class="score-breakdown-item" style="border: 2px solid #e74c3c; background: white; padding: 15px; border-radius: 8px;">
                    <div class="score-breakdown-label" style="color: #7f8c8d; font-size: 13px;">市场端</div>
                    <div class="score-breakdown-value" style="color: #e74c3c; font-size: 28px; font-weight: 700;">${mScore100}<span style="font-size: 14px;">分</span></div>
                    <div style="font-size: 12px; color: #95a5a6; margin-top: 5px;">5分制: ${mScore5}</div>
                </div>
                <div class="score-breakdown-item" style="border: 2px solid #3498db; background: white; padding: 15px; border-radius: 8px;">
                    <div class="score-breakdown-label" style="color: #7f8c8d; font-size: 13px;">研发端</div>
                    <div class="score-breakdown-value" style="color: #3498db; font-size: 28px; font-weight: 700;">${tScore100}<span style="font-size: 14px;">分</span></div>
                    <div style="font-size: 12px; color: #95a5a6; margin-top: 5px;">5分制: ${tScore5}</div>
                </div>
                <div class="score-breakdown-item" style="border: 2px solid #9b59b6; background: white; padding: 15px; border-radius: 8px;">
                    <div class="score-breakdown-label" style="color: #7f8c8d; font-size: 13px;">专利端</div>
                    <div class="score-breakdown-value" style="color: #9b59b6; font-size: 28px; font-weight: 700;">${pScore100}<span style="font-size: 14px;">分</span></div>
                    <div style="font-size: 12px; color: #95a5a6; margin-top: 5px;">5分制: ${pScore5}</div>
                </div>
            </div>
        </div>

        <!-- 各维度详细分数 -->
        <div style="margin-bottom:25px;">
            <h4 style="color:#2c3e50;margin-bottom:15px;border-bottom:2px solid #34495e;padding-bottom:10px;">📋 各维度详细分数</h4>
            ${dimensionScoresHTML}
        </div>

        <!-- 分数段价值建议 -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; border-radius: 12px; margin-bottom: 25px; color: white;">
            <h4 style="margin-bottom: 15px; font-size: 1.1rem;">🎯 当前分数段价值建议</h4>
            ${scoreRangeGuide}
        </div>

        <div style="margin-bottom:25px;">
            <h4 style="color:#2c3e50;margin-bottom:15px;border-bottom:2px solid #e74c3c;padding-bottom:10px;">⚖️ 专利布局建议</h4>
            ${suggestions.patent.map(s => `<div style="padding:10px;background:#fdf2f2;border-left:3px solid #e74c3c;margin:8px 0;border-radius:0 8px 8px 0;">${s}</div>`).join('')}
        </div>

        <div style="margin-bottom:25px;">
            <h4 style="color:#2c3e50;margin-bottom:15px;border-bottom:2px solid #3498db;padding-bottom:10px;">🔬 研发方向建议</h4>
            ${suggestions.tech.map(s => `<div style="padding:10px;background:#f0f8ff;border-left:3px solid #3498db;margin:8px 0;border-radius:0 8px 8px 0;">${s}</div>`).join('')}
        </div>

        <div style="margin-bottom:25px;">
            <h4 style="color:#2c3e50;margin-bottom:15px;border-bottom:2px solid #f39c12;padding-bottom:10px;">🎯 市场推广建议</h4>
            ${suggestions.market.map(s => `<div style="padding:10px;background:#fff8f0;border-left:3px solid #f39c12;margin:8px 0;border-radius:0 8px 8px 0;">${s}</div>`).join('')}
        </div>

        <div style="background:#e8f4fd;padding:20px;border-radius:12px;border-left:4px solid #3498db;">
            <h5 style="color:#2c3e50;margin-bottom:10px;">💡 总体评价</h5>
            <p style="color:#555;line-height:1.8;">${generateOverallComment(totalScore5, mScore5, tScore5, pScore5)}</p>
        </div>
    `;
}

// 生成所有维度的详细分数表格
function generateAllDimensionScoresTable(marketEval, techEval, patentEval) {
    const dimensionNames = {
        market: {
            m1_1: { name: 'Top级需求', weight: '40%', group: '用户买不买单 (50%)' },
            m1_2: { name: '未被满足需求', weight: '35%', group: '用户买不买单 (50%)' },
            m1_3: { name: 'Top级痛点', weight: '25%', group: '用户买不买单 (50%)' },
            m2_1: { name: '竞争格局', weight: '40%', group: '用户愿花多少钱 (30%)' },
            m2_2: { name: '溢价能力', weight: '60%', group: '用户愿花多少钱 (30%)' },
            m3_1: { name: '市场规模', weight: '50%', group: '市场规模与增长 (20%)' },
            m3_2: { name: '成长性', weight: '50%', group: '市场规模与增长 (20%)' }
        },
        tech: {
            t1_1: { name: '创新程度', weight: '100%', group: '创新程度 (40%)' },
            t2_1: { name: '竞争优势', weight: '100%', group: '竞争优势 (30%)' },
            t3_1: { name: '可扩展性', weight: '100%', group: '可扩展性 (30%)' }
        },
        patent: {
            p1_1: { name: '新颖性与实用性', weight: '100%', group: '新颖性与实用性 (30%)' },
            p2_1: { name: '撰写空间', weight: '100%', group: '撰写空间 (50%)' },
            p3_1: { name: '取证难度', weight: '100%', group: '取证难度 (20%)' }
        }
    };
    
    const deptColors = {
        market: { color: '#e74c3c', name: '市场端' },
        tech: { color: '#3498db', name: '研发端' },
        patent: { color: '#9b59b6', name: '专利端' }
    };
    
    let html = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 20px;">';
    
    // 市场端
    html += generateDeptDimensionTable('market', marketEval, dimensionNames, deptColors);
    
    // 研发端
    html += generateDeptDimensionTable('tech', techEval, dimensionNames, deptColors);
    
    // 专利端
    html += generateDeptDimensionTable('patent', patentEval, dimensionNames, deptColors);
    
    html += '</div>';
    return html;
}

function generateDeptDimensionTable(dept, evalData, dimensionNames, deptColors) {
    if (!evalData) return '';
    
    const names = dimensionNames[dept];
    const subScores = evalData.sub_scores || {};
    const deptInfo = deptColors[dept];
    const totalScore100 = (evalData.total_score * 20).toFixed(1);
    
    let tableHtml = `
        <div style="background: white; border: 2px solid ${deptInfo.color}; border-radius: 12px; overflow: hidden;">
            <div style="background: ${deptInfo.color}; color: white; padding: 15px; text-align: center;">
                <h5 style="margin: 0; font-size: 1.1rem;">${deptInfo.name}</h5>
                <div style="font-size: 1.5rem; font-weight: 700; margin-top: 5px;">${totalScore100}<span style="font-size: 0.8rem;">分</span></div>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem;">
                <thead>
                    <tr style="background: #f8f9fa;">
                        <th style="padding: 10px; border-bottom: 1px solid #dee2e6; text-align: left;">维度</th>
                        <th style="padding: 10px; border-bottom: 1px solid #dee2e6; text-align: center;">权重</th>
                        <th style="padding: 10px; border-bottom: 1px solid #dee2e6; text-align: center;">得分</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    let currentGroup = '';
    Object.entries(names).forEach(([key, info]) => {
        const score = subScores[key] || 0;
        
        if (info.group !== currentGroup) {
            currentGroup = info.group;
            tableHtml += `<tr style="background: #f1f3f5;"><td colspan="3" style="padding: 8px 10px; font-weight: 600; color: #495057; font-size: 0.8rem;">${info.group}</td></tr>`;
        }
        
        tableHtml += `
            <tr>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f3f5;">${info.name}</td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f3f5; text-align: center; color: #666;">${info.weight}</td>
                <td style="padding: 8px 10px; border-bottom: 1px solid #f1f3f5; text-align: center; font-weight: 600; color: ${deptInfo.color};">${score.toFixed(1)}</td>
            </tr>
        `;
    });
    
    tableHtml += '</tbody></table></div>';
    return tableHtml;
}

// 打印指导建议报告
function printGuideReport(projectId) {
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);
    const evals = db.evaluations.filter(e => e.project_id === projectId);
    
    const marketEval = evals.find(e => e.department === 'market');
    const techEval = evals.find(e => e.department === 'tech');
    const patentEval = evals.find(e => e.department === 'patent');
    
    const totalScore5 = ((marketEval.total_score + techEval.total_score + patentEval.total_score) / 3);
    const totalScore100 = (totalScore5 * 20).toFixed(1);
    
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>指导建议报告 - ${escapeHtml(project.name)}</title>
            <style>
                body { font-family: "Microsoft YaHei", Arial, sans-serif; padding: 40px; color: #333; max-width: 900px; margin: 0 auto; }
                h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 15px; margin-bottom: 30px; }
                h2 { color: #34495e; margin-top: 30px; border-left: 4px solid #3498db; padding-left: 15px; }
                .score-box { text-align: center; padding: 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 12px; margin: 20px 0; }
                .score-value { font-size: 48px; font-weight: bold; }
                .score-label { font-size: 14px; opacity: 0.9; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                th { background: #3498db; color: white; }
                tr:nth-child(even) { background: #f8f9fa; }
                @media print { body { padding: 20px; } .no-print { display: none; } }
            </style>
        </head>
        <body>
            <div class="no-print" style="text-align:right;margin-bottom:20px;">
                <button onclick="window.print()" style="padding:10px 20px;font-size:14px;cursor:pointer;">🖨️ 打印</button>
                <button onclick="window.close()" style="padding:10px 20px;font-size:14px;cursor:pointer;margin-left:10px;">✕ 关闭</button>
            </div>
            <h1>📋 指导建议报告</h1>
            <p><strong>方案名称：</strong>${escapeHtml(project.name)}</p>
            <p><strong>报告生成时间：</strong>${new Date().toLocaleString('zh-CN')}</p>
            <div class="score-box">
                <div class="score-label">综合评分</div>
                <div class="score-value">${totalScore100}分</div>
            </div>
            ${generateAllDimensionScoresTable(marketEval, techEval, patentEval)}
        </body>
        </html>
    `);
    printWindow.document.close();
}

// 下载指导建议报告
function downloadGuideReport(projectId) {
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);
    const evals = db.evaluations.filter(e => e.project_id === projectId);
    
    const marketEval = evals.find(e => e.department === 'market');
    const techEval = evals.find(e => e.department === 'tech');
    const patentEval = evals.find(e => e.department === 'patent');
    
    const totalScore5 = ((marketEval.total_score + techEval.total_score + patentEval.total_score) / 3);
    const totalScore100 = (totalScore5 * 20).toFixed(1);
    
    const fileName = `指导建议报告-${project.name}-${new Date().toISOString().split('T')[0]}.html`;
    
    const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>指导建议报告 - ${escapeHtml(project.name)}</title>
    <style>
        body { font-family: "Microsoft YaHei", Arial, sans-serif; padding: 40px; color: #333; max-width: 900px; margin: 0 auto; }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 15px; margin-bottom: 30px; }
        h2 { color: #34495e; margin-top: 30px; border-left: 4px solid #3498db; padding-left: 15px; }
        .score-box { text-align: center; padding: 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 12px; margin: 20px 0; }
        .score-value { font-size: 48px; font-weight: bold; }
        .score-label { font-size: 14px; opacity: 0.9; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background: #3498db; color: white; }
        tr:nth-child(even) { background: #f8f9fa; }
    </style>
</head>
<body>
    <h1>📋 指导建议报告</h1>
    <p><strong>方案名称：</strong>${escapeHtml(project.name)}</p>
    <p><strong>报告生成时间：</strong>${new Date().toLocaleString('zh-CN')}</p>
    <div class="score-box">
        <div class="score-label">综合评分</div>
        <div class="score-value">${totalScore100}分</div>
    </div>
    ${generateAllDimensionScoresTable(marketEval, techEval, patentEval)}
</body>
</html>`;

    const blob = new Blob([fullHTML], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 生成分数段价值建议
function generateScoreRangeGuide(score100) {
    const score = parseFloat(score100);
    
    if (score >= 90) {
        return `
            <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px;">
                <h5 style="margin: 0 0 10px 0; font-size: 1.1rem;">🏆 优秀级 (90-100分)</h5>
                <p style="margin: 0; line-height: 1.6; opacity: 0.95;">
                    <strong>价值定位：</strong>极具价值的优质项目<br>
                    <strong>专利建议：</strong>强烈建议申请发明专利，可考虑 PCT 国际布局<br>
                    <strong>资源投入：</strong>优先配置资源，快速推进<br>
                    <strong>预期收益：</strong>高市场回报，强技术壁垒
                </p>
            </div>
        `;
    } else if (score >= 80) {
        return `
            <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px;">
                <h5 style="margin: 0 0 10px 0; font-size: 1.1rem;">⭐ 良好级 (80-89分)</h5>
                <p style="margin: 0; line-height: 1.6; opacity: 0.95;">
                    <strong>价值定位：</strong>高价值项目<br>
                    <strong>专利建议：</strong>建议申请发明专利，重点完善权利要求<br>
                    <strong>资源投入：</strong>稳健推进，针对性优化薄弱环节<br>
                    <strong>预期收益：</strong>较好市场回报，一定技术壁垒
                </p>
            </div>
        `;
    } else if (score >= 70) {
        return `
            <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px;">
                <h5 style="margin: 0 0 10px 0; font-size: 1.1rem;">📈 中上级 (70-79分)</h5>
                <p style="margin: 0; line-height: 1.6; opacity: 0.95;">
                    <strong>价值定位：</strong>中等偏上价值项目<br>
                    <strong>专利建议：</strong>建议申请实用新型专利或完善后申请发明<br>
                    <strong>资源投入：</strong>控制投入，聚焦核心改进点<br>
                    <strong>预期收益：</strong>中等市场回报，需差异化竞争
                </p>
            </div>
        `;
    } else if (score >= 60) {
        return `
            <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px;">
                <h5 style="margin: 0 0 10px 0; font-size: 1.1rem;">⚠️ 中级 (60-69分)</h5>
                <p style="margin: 0; line-height: 1.6; opacity: 0.95;">
                    <strong>价值定位：</strong>中等价值项目<br>
                    <strong>专利建议：</strong>谨慎评估，建议先完善技术方案<br>
                    <strong>资源投入：</strong>有限投入，设定明确止损点<br>
                    <strong>预期收益：</strong>市场回报不确定，需重新定位
                </p>
            </div>
        `;
    } else if (score >= 50) {
        return `
            <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px;">
                <h5 style="margin: 0 0 10px 0; font-size: 1.1rem;">🔍 中下 (50-59分)</h5>
                <p style="margin: 0; line-height: 1.6; opacity: 0.95;">
                    <strong>价值定位：</strong>较低价值项目<br>
                    <strong>专利建议：</strong>不建议申请专利，考虑技术秘密保护<br>
                    <strong>资源投入：</strong>最小化投入，深入复盘原因<br>
                    <strong>预期收益：</strong>市场回报较低，需重大调整
                </p>
            </div>
        `;
    } else {
        return `
            <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px;">
                <h5 style="margin: 0 0 10px 0; font-size: 1.1rem;">❌ 待改进 (0-49分)</h5>
                <p style="margin: 0; line-height: 1.6; opacity: 0.95;">
                    <strong>价值定位：</strong>低价值项目<br>
                    <strong>专利建议：</strong>不建议申请专利<br>
                    <strong>资源投入：</strong>建议终止或彻底转型<br>
                    <strong>预期收益：</strong>市场回报极低，需重新评估方向
                </p>
            </div>
        `;
    }
}

function generateSuggestions(mScore, tScore, pScore) {
    const suggestions = { patent: [], tech: [], market: [] };

    // 专利建议
    if (pScore >= 4) {
        suggestions.patent.push('✅ 授权前景极佳，建议尽快提交高质量专利申请');
        suggestions.patent.push('✅ 保护范围广阔，可考虑 PCT 国际专利布局');
        suggestions.patent.push('✅ 维权取证容易，适合构建专利壁垒');
    } else if (pScore >= 3) {
        suggestions.patent.push('⚠️ 授权可能性中等，建议优化权利要求布局');
        suggestions.patent.push('⚠️ 撰写空间有限，需精准界定保护范围');
        suggestions.patent.push('⚠️ 取证难度适中，建议配合技术秘密保护');
    } else {
        suggestions.patent.push('❌ 授权风险较高，建议重新评估申请策略');
        suggestions.patent.push('❌ 保护范围狭窄，考虑作为技术秘密保护');
        suggestions.patent.push('❌ 维权难度大，需评估商业价值是否值得投入');
    }

    // 研发建议
    if (tScore >= 4) {
        suggestions.tech.push('✅ 技术创新性强，建议持续投入资源深化研发');
        suggestions.tech.push('✅ 竞争优势明显，可快速推进产品化落地');
        suggestions.tech.push('✅ 可扩展性好，探索跨产品线应用场景');
    } else if (tScore >= 3) {
        suggestions.tech.push('⚠️ 技术有一定创新性，建议进一步优化关键指标');
        suggestions.tech.push('⚠️ 竞争优势不够突出，需加强差异化特性');
        suggestions.tech.push('⚠️ 扩展性一般，优先聚焦核心应用场景');
    } else {
        suggestions.tech.push('❌ 技术创新不足，建议重新评估技术路线');
        suggestions.tech.push('❌ 相比竞品无明显优势，需寻找新的突破点');
        suggestions.tech.push('❌ 可扩展性弱，谨慎评估研发投入产出比');
    }

    // 市场建议
    if (mScore >= 4) {
        suggestions.market.push('✅ 市场需求强烈，建议加速商业化进程');
        suggestions.market.push('✅ 用户付费意愿高，可采取溢价策略');
        suggestions.market.push('✅ 市场规模大且增长快，优先配置营销资源');
    } else if (mScore >= 3) {
        suggestions.market.push('⚠️ 市场需求存在但不够强烈，建议精准定位细分人群');
        suggestions.market.push('⚠️ 价格敏感度中等，需平衡定价与销量');
        suggestions.market.push('⚠️ 市场规模有限，建议控制推广成本');
    } else {
        suggestions.market.push('❌ 市场需求疲弱，建议重新评估目标用户群体');
        suggestions.market.push('❌ 用户付费意愿低，需探索新的商业模式');
        suggestions.market.push('❌ 市场增长乏力，谨慎评估进入时机');
    }

    return suggestions;
}

function generateOverallComment(total, m, t, p) {
    const total100 = (total * 20).toFixed(1);
    const m100 = (m * 20).toFixed(1);
    const t100 = (t * 20).toFixed(1);
    const p100 = (p * 20).toFixed(1);
    
    if (total >= 4) {
        return `该项目综合评分为<strong style="color:#27ae60;">${total100}分</strong>（百分制），属于<b>极具价值</b>的优质项目。市场端 (${m100}分)、研发端 (${t100}分)、专利端 (${p100}分) 三方评估均表现出色，建议：<br>• <strong>优先配置资源</strong>，加速推进商业化落地<br>• <strong>构建专利组合</strong>，形成技术壁垒和市场护城河<br>• <strong>快速占领市场</strong>，把握时间窗口建立先发优势`;
    } else if (total >= 3) {
        return `该项目综合评分为<strong style="color:#3498db;">${total100}分</strong>（百分制），属于<b>高价值</b>项目。三方评估中存在一定差异，建议：<br>• <strong>针对性优化</strong>：重点关注评分较低的维度，制定改进计划<br>• <strong>差异化竞争</strong>：发挥优势维度的长处，形成独特竞争力<br>• <strong>稳健推进</strong>：在控制风险的前提下逐步投入资源`;
    } else if (total >= 2) {
        return `该项目综合评分为<strong style="color:#f39c12;">${total100}分</strong>（百分制），属于<b>中等价值</b>项目。整体表现平平，建议：<br>• <strong>重新评估定位</strong>：审视目标市场和用户需求是否准确<br>• <strong>聚焦核心场景</strong>：避免资源分散，集中突破关键点<br>• <strong>谨慎投入</strong>：设定明确的里程碑和止损点`;
    } else {
        return `该项目综合评分为<strong style="color:#e74c3c;">${total100}分</strong>（百分制），属于<b>低价值</b>项目。三方评估结果均不理想，建议：<br>• <strong>深入复盘</strong>：分析根本原因，判断是否为方向性问题<br>• <strong>考虑转型</strong>：评估是否有调整技术路线或目标市场的可能<br>• <strong>及时止损</strong>：如确认无商业价值，建议终止项目避免进一步资源浪费`;
    }
}

// ==================== 统一AI分析报告 ====================
function showUnifiedAIReport(projectId) {
    window.currentReportProjectId = projectId;
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);
    const evals = db.evaluations.filter(e => e.project_id === projectId);
    
    const marketEval = evals.find(e => e.department === 'market');
    const techEval = evals.find(e => e.department === 'tech');
    const patentEval = evals.find(e => e.department === 'patent');
    
    if (!marketEval || !techEval || !patentEval) {
        alert('请等待三端评估完成后再查看AI分析报告');
        return;
    }
    
    const reportHTML = generateUnifiedReportHTML(project, marketEval, techEval, patentEval);
    document.getElementById('aiReportContent').innerHTML = reportHTML;
    document.getElementById('aiReportModalTitle').textContent = '📋 AI智能分析报告 - ' + project.name;
    show('aiReportModal');
}

// 生成统一的AI分析报告HTML
function generateUnifiedReportHTML(project, marketEval, techEval, patentEval) {
    const totalScore5 = ((marketEval.total_score + techEval.total_score + patentEval.total_score) / 3);
    const totalScore100 = (totalScore5 * 20).toFixed(1);
    const level = Utils.getLevel(totalScore5);
    
    const mScore100 = (marketEval.total_score * 20).toFixed(1);
    const tScore100 = (techEval.total_score * 20).toFixed(1);
    const pScore100 = (patentEval.total_score * 20).toFixed(1);
    
    // 获取各维度详细分数
    const mSub = marketEval.sub_scores || {};
    const tSub = techEval.sub_scores || {};
    const pSub = patentEval.sub_scores || {};
    
    // 分析各维度强弱
    const strengths = [];
    const weaknesses = [];
    
    // 市场端分析
    const marketC1 = (mSub.m1_1 || 0) * 0.4 + (mSub.m1_2 || 0) * 0.35 + (mSub.m1_3 || 0) * 0.25;
    const marketC2 = (mSub.m2_1 || 0) * 0.4 + (mSub.m2_2 || 0) * 0.6;
    const marketC3 = ((mSub.m3_1 || 0) + (mSub.m3_2 || 0)) / 2;
    
    if (marketEval.total_score * 20 >= 80) {
        strengths.push(`市场端综合评分${mScore100}分，市场需求强劲，商业价值突出`);
        if (marketC1 >= 4) strengths.push('用户购买意愿强烈，属于Top级需求');
        if (marketC2 >= 4) strengths.push('用户支付意愿高，具有显著溢价能力');
        if (marketC3 >= 4) strengths.push('目标市场规模大且增长迅速');
    } else if (marketEval.total_score * 20 < 60) {
        weaknesses.push(`市场端评分${mScore100}分偏低，需重新评估市场定位`);
        if (marketC1 < 3) weaknesses.push('用户需求不够强烈，可能非核心痛点');
        if (marketC2 < 3) weaknesses.push('溢价能力有限，商业化前景存疑');
        if (marketC3 < 3) weaknesses.push('市场规模较小或增长乏力');
    }
    
    // 研发端分析
    if (techEval.total_score * 20 >= 80) {
        strengths.push(`研发端评分${tScore100}分，技术创新性强，具有核心竞争力`);
        if ((tSub.t1_1 || 0) >= 4) strengths.push('创新程度高，可能具有颠覆性技术突破');
        if ((tSub.t2_1 || 0) >= 4) strengths.push('相比竞品具有显著技术优势');
        if ((tSub.t3_1 || 0) >= 4) strengths.push('技术可扩展性好，具有平台化潜力');
    } else if (techEval.total_score * 20 < 60) {
        weaknesses.push(`研发端评分${tScore100}分，技术竞争力有待提升`);
        if ((tSub.t1_1 || 0) < 3) weaknesses.push('创新程度不足，可能为常规改进');
        if ((tSub.t2_1 || 0) < 3) weaknesses.push('相比竞品无明显优势');
        if ((tSub.t3_1 || 0) < 3) weaknesses.push('技术扩展性有限，应用场景狭窄');
    }
    
    // 专利端分析
    if (patentEval.total_score * 20 >= 80) {
        strengths.push(`专利端评分${pScore100}分，可专利性良好，保护前景乐观`);
        if ((pSub.p1_1 || 0) >= 4) strengths.push('新颖性和创造性高，授权前景极佳');
        if ((pSub.p2_1 || 0) >= 4) strengths.push('撰写空间大，可构建宽广权利要求');
        if ((pSub.p3_1 || 0) >= 4) strengths.push('取证维权容易，专利保护价值高');
    } else if (patentEval.total_score * 20 < 60) {
        weaknesses.push(`专利端评分${pScore100}分，专利保护前景有限`);
        if ((pSub.p1_1 || 0) < 3) weaknesses.push('新颖性和创造性存疑，授权风险较高');
        if ((pSub.p2_1 || 0) < 3) weaknesses.push('撰写空间有限，权利要求可能较窄');
        if ((pSub.p3_1 || 0) < 3) weaknesses.push('取证维权困难，专利保护价值低');
    }
    
    // 生成决策建议
    let decision, patentStrategy, riskLevel, actionPlan;
    const score = parseFloat(totalScore100);
    
    if (score >= 90) {
        decision = '强烈推荐申请专利';
        patentStrategy = '该技术方案在三个维度均表现优异，建议立即启动发明专利申请流程，并考虑PCT国际专利申请以扩大保护范围。技术方案具有明确的市场需求、突出的技术创新性和良好的可专利性，是值得重点投入的优质项目。';
        riskLevel = '低';
        actionPlan = [
            '立即启动发明专利申请流程，准备高质量专利申请文件',
            '进行全面的现有技术检索，确保权利要求的创造性',
            '考虑PCT国际专利申请，布局海外市场',
            '同步推进产品化落地，抢占市场先机',
            '构建专利组合，形成技术壁垒'
        ];
    } else if (score >= 80) {
        decision = '建议申请专利';
        patentStrategy = '该技术方案整体价值较高，具备申请专利的基本条件。建议在完善部分薄弱环节后提交专利申请，重点关注评分较低的维度，通过技术优化提升整体竞争力。';
        riskLevel = '较低';
        actionPlan = [
            '针对薄弱环节进行技术优化，提升整体评分',
            '完善技术方案的实施例，增强说明书支撑',
            '精心设计权利要求布局，构建金字塔式保护体系',
            '加强现有技术检索，规避潜在侵权风险',
            '制定分阶段专利申请策略'
        ];
    } else if (score >= 70) {
        decision = '建议完善后申请';
        patentStrategy = '该技术方案具有一定价值，但存在明显短板。建议先进行针对性改进，待评分提升后再申请专利。可考虑先申请实用新型专利获得快速保护，同时持续优化技术方案。';
        riskLevel = '中等';
        actionPlan = [
            '深入分析各维度低分原因，制定针对性改进方案',
            '优先改进核心创新点，提升技术竞争力',
            '考虑先申请实用新型专利，获得快速临时保护',
            '重新评估目标市场，优化产品定位',
            '设定明确的改进目标和时间节点'
        ];
    } else if (score >= 60) {
        decision = '谨慎评估';
        patentStrategy = '该技术方案价值一般，专利授权概率和保护价值均存在不确定性。建议深入评估技术改进的可行性和商业回报，谨慎决定是否投入专利申请资源。';
        riskLevel = '较高';
        actionPlan = [
            '全面复盘技术方案，识别核心问题',
            '评估技术路线调整的可能性和成本',
            '考虑技术秘密保护作为替代方案',
            '重新评估目标市场和用户需求',
            '设定明确的止损点和决策节点'
        ];
    } else {
        decision = '不建议申请专利';
        patentStrategy = '基于当前评估结果，该技术方案在市场需求、技术创新性或可专利性方面存在明显不足，不建议投入资源申请专利。建议考虑其他保护方式或重新评估项目方向。';
        riskLevel = '高';
        actionPlan = [
            '考虑技术秘密保护方式，避免技术公开',
            '评估技术路线彻底转型的可行性',
            '重新审视项目的商业价值和市场需求',
            '必要时终止项目，避免进一步资源浪费',
            '总结失败经验，指导后续项目决策'
        ];
    }
    
    // 图片展示
    const imagesHtml = project.images && project.images.length > 0 
        ? `<div class="report-images-grid">
            ${project.images.map((img, i) => `<div class="report-image-item"><img src="${img}" alt="技术方案图片${i+1}"><span class="image-caption">图${i+1}</span></div>`).join('')}
           </div>`
        : '<p class="no-data">暂无技术方案图片</p>';
    
    // 生成报告日期
    const reportDate = new Date().toLocaleString('zh-CN', { 
        year: 'numeric', month: 'long', day: 'numeric', 
        hour: '2-digit', minute: '2-digit' 
    });
    
    return `
        <div class="unified-report">
            <!-- 报告头部 -->
            <div class="report-header-section">
                <div class="report-title">专利技术方案评估分析报告</div>
                <div class="report-subtitle">AI智能综合分析</div>
                <div class="report-meta">
                    <span>报告编号：${project.id.slice(-8).toUpperCase()}</span>
                    <span>生成时间：${reportDate}</span>
                </div>
            </div>
            
            <!-- 方案基本信息 -->
            <div class="report-section">
                <div class="section-title">一、方案基本信息</div>
                <div class="info-grid">
                    <div class="info-row">
                        <span class="info-label">方案名称：</span>
                        <span class="info-value">${escapeHtml(project.name)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">创建人：</span>
                        <span class="info-value">${project.creator}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">创建时间：</span>
                        <span class="info-value">${Utils.formatDate(project.created_at)}</span>
                    </div>
                </div>
            </div>
            
            <!-- 方案描述 -->
            <div class="report-section">
                <div class="section-title">二、技术方案描述</div>
                <div class="description-box">
                    ${escapeHtml(project.description || '暂无描述')}
                </div>
            </div>
            
            <!-- 技术方案图片 -->
            <div class="report-section">
                <div class="section-title">三、技术方案附图</div>
                ${imagesHtml}
            </div>
            
            <!-- 综合评分 -->
            <div class="report-section">
                <div class="section-title">四、综合评分结果</div>
                <div class="total-score-box ${level.class}">
                    <div class="score-number">${totalScore100}</div>
                    <div class="score-unit">分</div>
                    <div class="score-level">${level.title}</div>
                </div>
                
                <div class="dept-scores-detail">
                    <div class="dept-score-item market">
                        <div class="dept-icon">🏢</div>
                        <div class="dept-name">市场端</div>
                        <div class="dept-score">${mScore100}<span>分</span></div>
                        <div class="dept-score-5">5分制：${marketEval.total_score.toFixed(2)}</div>
                    </div>
                    <div class="dept-score-item tech">
                        <div class="dept-icon">🔬</div>
                        <div class="dept-name">研发端</div>
                        <div class="dept-score">${tScore100}<span>分</span></div>
                        <div class="dept-score-5">5分制：${techEval.total_score.toFixed(2)}</div>
                    </div>
                    <div class="dept-score-item patent">
                        <div class="dept-icon">⚖️</div>
                        <div class="dept-name">专利端</div>
                        <div class="dept-score">${pScore100}<span>分</span></div>
                        <div class="dept-score-5">5分制：${patentEval.total_score.toFixed(2)}</div>
                    </div>
                </div>
            </div>
            
            <!-- 各维度详细评分 -->
            <div class="report-section">
                <div class="section-title">五、各维度详细评分</div>
                <div class="dimension-tables">
                    ${generateMarketDetailTable(marketEval)}
                    ${generateTechDetailTable(techEval)}
                    ${generatePatentDetailTable(patentEval)}
                </div>
            </div>
            
            <!-- AI智能分析 -->
            <div class="report-section">
                <div class="section-title">六、AI智能分析</div>
                
                <!-- 优势分析 -->
                <div class="analysis-box strengths">
                    <div class="analysis-title">💪 核心优势</div>
                    ${strengths.length > 0 
                        ? `<ul class="analysis-list">${strengths.map(s => `<li>${s}</li>`).join('')}</ul>`
                        : '<p class="no-data">暂无显著优势</p>'
                    }
                </div>
                
                <!-- 待改进项 -->
                <div class="analysis-box weaknesses">
                    <div class="analysis-title">⚠️ 待改进项</div>
                    ${weaknesses.length > 0 
                        ? `<ul class="analysis-list">${weaknesses.map(w => `<li>${w}</li>`).join('')}</ul>`
                        : '<p class="no-data">暂无显著弱项</p>'
                    }
                </div>
            </div>
            
            <!-- 专利决策建议 -->
            <div class="report-section">
                <div class="section-title">七、专利决策建议</div>
                
                <div class="decision-box">
                    <div class="decision-header">
                        <span class="decision-label">综合决策：</span>
                        <span class="decision-value ${score >= 80 ? 'positive' : score >= 60 ? 'neutral' : 'negative'}">${decision}</span>
                    </div>
                    <div class="risk-level">
                        <span class="risk-label">风险等级：</span>
                        <span class="risk-value risk-${riskLevel === '低' ? 'low' : riskLevel === '较低' ? 'low' : riskLevel === '中等' ? 'medium' : 'high'}">${riskLevel}</span>
                    </div>
                </div>
                
                <div class="strategy-box">
                    <div class="strategy-title">📝 专利策略建议</div>
                    <div class="strategy-content">${patentStrategy}</div>
                </div>
                
                <div class="action-box">
                    <div class="action-title">🎯 行动计划</div>
                    <ol class="action-list">
                        ${actionPlan.map((item, i) => `<li><span class="action-num">${i + 1}</span>${item}</li>`).join('')}
                    </ol>
                </div>
            </div>
            
            <!-- 分数段价值建议 -->
            <div class="report-section">
                <div class="section-title">八、价值评定说明</div>
                ${generateScoreRangeGuideHTML(totalScore100)}
            </div>
            
            <!-- 报告尾部 -->
            <div class="report-footer">
                <p>本报告由专利技术方案三方评估系统自动生成</p>
                <p>报告内容仅供参考，具体决策请结合实际情况</p>
            </div>
        </div>
    `;
}

// 生成市场端详细评分表
function generateMarketDetailTable(evalData) {
    const s = evalData.sub_scores || {};
    const c1 = ((s.m1_1 || 0) * 0.4 + (s.m1_2 || 0) * 0.35 + (s.m1_3 || 0) * 0.25).toFixed(2);
    const c2 = ((s.m2_1 || 0) * 0.4 + (s.m2_2 || 0) * 0.6).toFixed(2);
    const c3 = (((s.m3_1 || 0) + (s.m3_2 || 0)) / 2).toFixed(2);
    
    return `
        <div class="dimension-table-wrapper market">
            <div class="dimension-table-header">
                <span class="dept-icon">🏢</span>
                <span>市场端评估</span>
                <span class="dimension-total">${(evalData.total_score * 20).toFixed(1)}分</span>
            </div>
            <table class="dimension-table">
                <thead>
                    <tr><th>评估维度</th><th>得分</th><th>权重</th><th>小计</th></tr>
                </thead>
                <tbody>
                    <tr class="group-header"><td colspan="4">用户买不买单（50%）</td></tr>
                    <tr><td>Top级需求</td><td>${(s.m1_1 || 0).toFixed(1)}</td><td>40%</td><td rowspan="3">${c1}</td></tr>
                    <tr><td>未被满足需求</td><td>${(s.m1_2 || 0).toFixed(1)}</td><td>35%</td></tr>
                    <tr><td>Top级痛点</td><td>${(s.m1_3 || 0).toFixed(1)}</td><td>25%</td></tr>
                    <tr class="group-header"><td colspan="4">用户愿花多少钱（30%）</td></tr>
                    <tr><td>竞争格局</td><td>${(s.m2_1 || 0).toFixed(1)}</td><td>40%</td><td rowspan="2">${c2}</td></tr>
                    <tr><td>溢价能力</td><td>${(s.m2_2 || 0).toFixed(1)}</td><td>60%</td></tr>
                    <tr class="group-header"><td colspan="4">市场规模与增长（20%）</td></tr>
                    <tr><td>市场规模</td><td>${(s.m3_1 || 0).toFixed(1)}</td><td>50%</td><td rowspan="2">${c3}</td></tr>
                    <tr><td>成长性</td><td>${(s.m3_2 || 0).toFixed(1)}</td><td>50%</td></tr>
                </tbody>
            </table>
        </div>
    `;
}

// 生成研发端详细评分表
function generateTechDetailTable(evalData) {
    const s = evalData.sub_scores || {};
    
    return `
        <div class="dimension-table-wrapper tech">
            <div class="dimension-table-header">
                <span class="dept-icon">🔬</span>
                <span>研发端评估</span>
                <span class="dimension-total">${(evalData.total_score * 20).toFixed(1)}分</span>
            </div>
            <table class="dimension-table">
                <thead>
                    <tr><th>评估维度</th><th>得分</th><th>权重</th></tr>
                </thead>
                <tbody>
                    <tr class="group-header"><td colspan="3">创新程度（40%）</td></tr>
                    <tr><td>创新程度</td><td>${(s.t1_1 || 0).toFixed(1)}</td><td>100%</td></tr>
                    <tr class="group-header"><td colspan="3">竞争优势（30%）</td></tr>
                    <tr><td>相比竞品优势</td><td>${(s.t2_1 || 0).toFixed(1)}</td><td>100%</td></tr>
                    <tr class="group-header"><td colspan="3">可扩展性（30%）</td></tr>
                    <tr><td>可迁移应用</td><td>${(s.t3_1 || 0).toFixed(1)}</td><td>100%</td></tr>
                </tbody>
            </table>
        </div>
    `;
}

// 生成专利端详细评分表
function generatePatentDetailTable(evalData) {
    const s = evalData.sub_scores || {};
    
    return `
        <div class="dimension-table-wrapper patent">
            <div class="dimension-table-header">
                <span class="dept-icon">⚖️</span>
                <span>专利端评估</span>
                <span class="dimension-total">${(evalData.total_score * 20).toFixed(1)}分</span>
            </div>
            <table class="dimension-table">
                <thead>
                    <tr><th>评估维度</th><th>得分</th><th>权重</th></tr>
                </thead>
                <tbody>
                    <tr class="group-header"><td colspan="3">新颖性（30%）</td></tr>
                    <tr><td>授权前景</td><td>${(s.p1_1 || 0).toFixed(1)}</td><td>100%</td></tr>
                    <tr class="group-header"><td colspan="3">撰写空间（50%）</td></tr>
                    <tr><td>保护范围</td><td>${(s.p2_1 || 0).toFixed(1)}</td><td>100%</td></tr>
                    <tr class="group-header"><td colspan="3">取证难度（20%）</td></tr>
                    <tr><td>维权难易</td><td>${(s.p3_1 || 0).toFixed(1)}</td><td>100%</td></tr>
                </tbody>
            </table>
        </div>
    `;
}

// 生成分数段价值建议HTML
function generateScoreRangeGuideHTML(score100) {
    const score = parseFloat(score100);
    
    let guideHTML = '';
    if (score >= 90) {
        guideHTML = `
            <div class="score-guide excellent">
                <div class="guide-header">🏆 优秀级（90-100分）</div>
                <div class="guide-content">
                    <p><strong>价值定位：</strong>极具价值的优质项目，市场需求强劲、技术创新突出、可专利性良好。</p>
                    <p><strong>专利建议：</strong>强烈建议申请发明专利，优先考虑PCT国际布局。</p>
                    <p><strong>资源投入：</strong>优先配置资源，快速推进商业化落地。</p>
                    <p><strong>预期收益：</strong>高市场回报，强技术壁垒，建议重点投入。</p>
                </div>
            </div>`;
    } else if (score >= 80) {
        guideHTML = `
            <div class="score-guide good">
                <div class="guide-header">⭐ 良好级（80-89分）</div>
                <div class="guide-content">
                    <p><strong>价值定位：</strong>高价值项目，整体表现良好，个别维度有提升空间。</p>
                    <p><strong>专利建议：</strong>建议申请发明专利，完善薄弱环节后提交。</p>
                    <p><strong>资源投入：</strong>稳健推进，针对性优化短板维度。</p>
                    <p><strong>预期收益：</strong>较好市场回报，一定技术壁垒，值得投入。</p>
                </div>
            </div>`;
    } else if (score >= 70) {
        guideHTML = `
            <div class="score-guide average">
                <div class="guide-header">📈 中上级（70-79分）</div>
                <div class="guide-content">
                    <p><strong>价值定位：</strong>中等偏上价值，具备一定竞争力但存在明显短板。</p>
                    <p><strong>专利建议：</strong>建议完善后申请，或先申请实用新型专利。</p>
                    <p><strong>资源投入：</strong>控制投入，聚焦核心改进点。</p>
                    <p><strong>预期收益：</strong>中等市场回报，需差异化竞争。</p>
                </div>
            </div>`;
    } else if (score >= 60) {
        guideHTML = `
            <div class="score-guide caution">
                <div class="guide-header">⚠️ 中级（60-69分）</div>
                <div class="guide-content">
                    <p><strong>价值定位：</strong>中等价值，竞争力一般，需大幅改进。</p>
                    <p><strong>专利建议：</strong>谨慎评估，建议先完善技术方案。</p>
                    <p><strong>资源投入：</strong>有限投入，设定明确止损点。</p>
                    <p><strong>预期收益：</strong>市场回报不确定，需重新定位。</p>
                </div>
            </div>`;
    } else {
        guideHTML = `
            <div class="score-guide poor">
                <div class="guide-header">❌ 待改进（0-59分）</div>
                <div class="guide-content">
                    <p><strong>价值定位：</strong>低价值项目，多个维度表现不佳。</p>
                    <p><strong>专利建议：</strong>不建议申请专利，考虑其他保护方式。</p>
                    <p><strong>资源投入：</strong>建议终止或彻底转型。</p>
                    <p><strong>预期收益：</strong>市场回报极低，需重新评估方向。</p>
                </div>
            </div>`;
    }
    
    return guideHTML;
}

// ==================== AI分析报告弹窗函数 ====================
function closeAIReportModal() {
    hide('aiReportModal');
}

// 从指导建议弹窗打印
function printGuideReportFromModal() {
    const projectId = window.currentGuideProjectId;
    if (projectId) printGuideReport(projectId);
}

// 从指导建议弹窗下载
function downloadGuideReportFromModal() {
    const projectId = window.currentGuideProjectId;
    if (projectId) downloadGuideReport(projectId);
}

// 生成AI分析报告HTML
function generateAIReportHTML(project, marketEval, techEval, patentEval, totalScore100) {
    const score = parseFloat(totalScore100);
    const marketScore100 = (marketEval.total_score * 20).toFixed(1);
    const techScore100 = (techEval.total_score * 20).toFixed(1);
    const patentScore100 = (patentEval.total_score * 20).toFixed(1);
    
    // 分析各维度强弱
    const strengths = [];
    const weaknesses = [];
    
    if (marketEval.total_score * 20 >= 80) strengths.push(`市场端评分${marketScore100}分，市场需求和商业价值良好`);
    else if (marketEval.total_score * 20 < 60) weaknesses.push(`市场端评分${marketScore100}分，需重新评估市场需求`);
    
    if (techEval.total_score * 20 >= 80) strengths.push(`研发端评分${techScore100}分，技术创新性较强`);
    else if (techEval.total_score * 20 < 60) weaknesses.push(`研发端评分${techScore100}分，技术竞争力不足`);
    
    if (patentEval.total_score * 20 >= 80) strengths.push(`专利端评分${patentScore100}分，可专利性良好`);
    else if (patentEval.total_score * 20 < 60) weaknesses.push(`专利端评分${patentScore100}分，专利保护前景有限`);
    
    // 根据总分生成建议
    let decision, patentStrategy, riskAnalysis, actionPlan;
    
    if (score >= 90) {
        decision = '✅ <strong style="color: #27ae60;">强烈推荐申请专利</strong>';
        patentStrategy = '建议立即申请发明专利，并考虑PCT国际专利申请。该技术方案在三个维度均表现优秀，具有较高的市场价值和技术壁垒。';
        riskAnalysis = '风险较低。建议充分检索现有技术，确保权利要求的创造性。';
        actionPlan = '1. 立即启动专利申请流程<br>2. 准备详细的专利申请材料<br>3. 考虑国际专利布局<br>4. 同步推进产品化落地';
    } else if (score >= 80) {
        decision = '✅ <strong style="color: #3498db;">建议申请专利</strong>';
        patentStrategy = '建议申请发明专利。该技术方案整体价值较高，但需针对薄弱环节进行优化。';
        riskAnalysis = '风险可控。建议重点关注评分较低的维度，完善技术方案。';
        actionPlan = '1. 针对薄弱环节进行技术优化<br>2. 完善专利申请材料<br>3. 加强现有技术检索<br>4. 制定专利布局策略';
    } else if (score >= 70) {
        decision = '⚠️ <strong style="color: #f39c12;">建议完善后申请</strong>';
        patentStrategy = '建议先进行技术方案的优化和完善，再申请专利。可考虑先申请实用新型专利进行快速保护。';
        riskAnalysis = '存在一定风险。专利授权概率中等，需针对性改进。';
        actionPlan = '1. 分析各维度薄弱环节<br>2. 制定技术改进方案<br>3. 完善后重新评估<br>4. 考虑实用新型专利先行';
    } else if (score >= 60) {
        decision = '❓ <strong style="color: #e67e22;">谨慎评估</strong>';
        patentStrategy = '建议谨慎评估专利申请的必要性。该技术方案价值一般，需大幅改进才能提升专利价值。';
        riskAnalysis = '风险较高。专利授权概率较低，保护价值有限。';
        actionPlan = '1. 深入分析低分原因<br>2. 评估技术改进可行性<br>3. 考虑技术秘密保护<br>4. 设定明确的止损点';
    } else {
        decision = '❌ <strong style="color: #e74c3c;">不建议申请专利</strong>';
        patentStrategy = '不建议申请专利。该技术方案在多个维度表现不佳，专利价值较低。';
        riskAnalysis = '风险很高。专利授权概率很低，投入产出比不佳。';
        actionPlan = '1. 考虑技术秘密保护方式<br>2. 评估技术路线调整<br>3. 重新定位目标市场<br>4. 必要时终止项目';
    }
    
    // 图片展示
    const imagesHtml = project.images && project.images.length > 0 
        ? `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 15px;">
            ${project.images.map(img => `<img src="${img}" style="width: 100%; height: 150px; object-fit: cover; border-radius: 8px; border: 1px solid #ddd;">`).join('')}
           </div>`
        : '<p style="color: #999;">暂无技术方案图片</p>';
    
    return `
        <div style="padding: 20px;">
            <!-- 方案信息 -->
            <div style="background: #f8f9fa; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
                <h4 style="color: #2c3e50; margin-bottom: 15px;">📋 方案信息</h4>
                <p style="margin: 5px 0;"><strong>方案名称：</strong>${escapeHtml(project.name)}</p>
                <p style="margin: 5px 0;"><strong>方案描述：</strong>${escapeHtml(project.description || '暂无描述')}</p>
                <p style="margin: 5px 0;"><strong>技术方案图片：</strong></p>
                ${imagesHtml}
            </div>
            
            <!-- 综合评估结论 -->
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; border-radius: 12px; color: white; margin-bottom: 20px;">
                <h4 style="margin-bottom: 15px; font-size: 1.2rem;">🤖 AI 专利撰写决策建议</h4>
                <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                    <h5 style="margin: 0 0 10px 0; font-size: 1rem;">📊 综合评估结论</h5>
                    <p style="margin: 0; line-height: 1.6; font-size: 1.1rem;">${decision}</p>
                    <p style="margin: 10px 0 0 0; line-height: 1.6; opacity: 0.95;">综合评分: <strong>${totalScore100}分</strong> (百分制)</p>
                </div>
            </div>
            
            <!-- 三端评分对比 -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 20px;">
                <div style="background: rgba(231, 76, 60, 0.1); border: 2px solid #e74c3c; border-radius: 12px; padding: 15px; text-align: center;">
                    <div style="color: #e74c3c; font-weight: 600;">🏢 市场端</div>
                    <div style="font-size: 1.8rem; font-weight: 700; color: #e74c3c;">${marketScore100}<span style="font-size: 0.8rem;">分</span></div>
                </div>
                <div style="background: rgba(52, 152, 219, 0.1); border: 2px solid #3498db; border-radius: 12px; padding: 15px; text-align: center;">
                    <div style="color: #3498db; font-weight: 600;">🔬 研发端</div>
                    <div style="font-size: 1.8rem; font-weight: 700; color: #3498db;">${techScore100}<span style="font-size: 0.8rem;">分</span></div>
                </div>
                <div style="background: rgba(155, 89, 182, 0.1); border: 2px solid #9b59b6; border-radius: 12px; padding: 15px; text-align: center;">
                    <div style="color: #9b59b6; font-weight: 600;">⚖️ 专利端</div>
                    <div style="font-size: 1.8rem; font-weight: 700; color: #9b59b6;">${patentScore100}<span style="font-size: 0.8rem;">分</span></div>
                </div>
            </div>
            
            <!-- 优势分析 -->
            <div style="background: #e8f5e9; padding: 20px; border-radius: 12px; margin-bottom: 20px; border-left: 4px solid #27ae60;">
                <h4 style="color: #27ae60; margin-bottom: 15px;">💪 优势分析</h4>
                ${strengths.length > 0 ? strengths.map(s => `<p style="margin: 8px 0; color: #333;">✓ ${s}</p>`).join('') : '<p style="color: #666;">暂无显著优势</p>'}
            </div>
            
            <!-- 待改进项 -->
            <div style="background: #ffebee; padding: 20px; border-radius: 12px; margin-bottom: 20px; border-left: 4px solid #e74c3c;">
                <h4 style="color: #e74c3c; margin-bottom: 15px;">⚠️ 待改进项</h4>
                ${weaknesses.length > 0 ? weaknesses.map(w => `<p style="margin: 8px 0; color: #333;">✗ ${w}</p>`).join('') : '<p style="color: #666;">暂无显著弱项</p>'}
            </div>
            
            <!-- 专利策略建议 -->
            <div style="background: #e3f2fd; padding: 20px; border-radius: 12px; margin-bottom: 20px; border-left: 4px solid #2196f3;">
                <h4 style="color: #2196f3; margin-bottom: 15px;">📝 专利策略建议</h4>
                <p style="margin: 8px 0; color: #333; line-height: 1.6;">${patentStrategy}</p>
            </div>
            
            <!-- 风险分析 -->
            <div style="background: #fff3e0; padding: 20px; border-radius: 12px; margin-bottom: 20px; border-left: 4px solid #ff9800;">
                <h4 style="color: #ff9800; margin-bottom: 15px;">⚡ 风险分析</h4>
                <p style="margin: 8px 0; color: #333; line-height: 1.6;">${riskAnalysis}</p>
            </div>
            
            <!-- 行动计划 -->
            <div style="background: #f3e5f5; padding: 20px; border-radius: 12px; border-left: 4px solid #9c27b0;">
                <h4 style="color: #9c27b0; margin-bottom: 15px;">🎯 行动计划</h4>
                <p style="margin: 8px 0; color: #333; line-height: 1.8;">${actionPlan}</p>
            </div>
        </div>
    `;
}

// 打印AI报告
function printAIReport() {
    const content = document.getElementById('aiReportContent').innerHTML;
    const title = document.getElementById('aiReportModalTitle').textContent;
    
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>${title}</title>
            <style>
                @page { size: A4; margin: 15mm; }
                * { box-sizing: border-box; }
                body { 
                    font-family: "Microsoft YaHei", "SimSun", Arial, sans-serif; 
                    color: #333; 
                    line-height: 1.8;
                    font-size: 11pt;
                    max-width: 210mm;
                    margin: 0 auto;
                    padding: 0;
                }
                
                /* 报告头部 */
                .report-header-section { 
                    text-align: center; 
                    padding: 30px 0; 
                    border-bottom: 3px double #2c3e50;
                    margin-bottom: 25px;
                }
                .report-title { 
                    font-size: 22pt; 
                    font-weight: bold; 
                    color: #2c3e50;
                    letter-spacing: 3px;
                    margin-bottom: 8px;
                }
                .report-subtitle { 
                    font-size: 14pt; 
                    color: #666;
                    margin-bottom: 15px;
                }
                .report-meta { 
                    font-size: 10pt; 
                    color: #999;
                }
                .report-meta span { margin: 0 15px; }
                
                /* 章节标题 */
                .report-section { 
                    margin-bottom: 25px; 
                    page-break-inside: avoid;
                }
                .section-title { 
                    font-size: 14pt; 
                    font-weight: bold; 
                    color: #2c3e50;
                    border-left: 4px solid #3498db;
                    padding-left: 12px;
                    margin-bottom: 15px;
                    page-break-after: avoid;
                }
                
                /* 信息网格 */
                .info-grid { 
                    background: #f8f9fa; 
                    padding: 15px 20px; 
                    border-radius: 8px;
                }
                .info-row { 
                    display: flex; 
                    margin: 8px 0;
                }
                .info-label { 
                    font-weight: 600; 
                    color: #555;
                    min-width: 100px;
                }
                .info-value { 
                    color: #333;
                    flex: 1;
                }
                
                /* 描述框 */
                .description-box { 
                    background: #f8f9fa; 
                    padding: 20px; 
                    border-radius: 8px;
                    border: 1px solid #e9ecef;
                    line-height: 1.8;
                    text-align: justify;
                }
                
                /* 图片网格 */
                .report-images-grid { 
                    display: grid; 
                    grid-template-columns: repeat(3, 1fr); 
                    gap: 15px;
                }
                .report-image-item { 
                    text-align: center;
                }
                .report-image-item img { 
                    width: 100%; 
                    max-height: 150px; 
                    object-fit: contain; 
                    border: 1px solid #ddd;
                    border-radius: 4px;
                }
                .image-caption { 
                    display: block; 
                    font-size: 9pt; 
                    color: #666;
                    margin-top: 5px;
                }
                .no-data { 
                    color: #999; 
                    font-style: italic;
                    text-align: center;
                    padding: 20px;
                }
                
                /* 综合评分 */
                .total-score-box { 
                    text-align: center; 
                    padding: 30px; 
                    border-radius: 12px;
                    margin-bottom: 20px;
                }
                .total-score-box.level-excellent { background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%); color: white; }
                .total-score-box.level-good { background: linear-gradient(135deg, #3498db 0%, #5dade2 100%); color: white; }
                .total-score-box.level-average { background: linear-gradient(135deg, #f39c12 0%, #f5b041 100%); color: white; }
                .total-score-box.level-poor { background: linear-gradient(135deg, #e74c3c 0%, #ec7063 100%); color: white; }
                .score-number { font-size: 56pt; font-weight: bold; }
                .score-unit { font-size: 18pt; }
                .score-level { 
                    font-size: 14pt; 
                    margin-top: 10px;
                    padding: 8px 20px;
                    background: rgba(255,255,255,0.2);
                    border-radius: 20px;
                    display: inline-block;
                }
                
                /* 三端评分 */
                .dept-scores-detail { 
                    display: grid; 
                    grid-template-columns: repeat(3, 1fr); 
                    gap: 15px;
                }
                .dept-score-item { 
                    text-align: center; 
                    padding: 20px; 
                    border-radius: 10px;
                    border: 2px solid;
                }
                .dept-score-item.market { border-color: #e74c3c; background: rgba(231, 76, 60, 0.05); }
                .dept-score-item.tech { border-color: #3498db; background: rgba(52, 152, 219, 0.05); }
                .dept-score-item.patent { border-color: #9b59b6; background: rgba(155, 89, 182, 0.05); }
                .dept-icon { font-size: 24pt; margin-bottom: 5px; }
                .dept-name { font-size: 11pt; color: #666; margin-bottom: 8px; }
                .dept-score { font-size: 28pt; font-weight: bold; }
                .dept-score span { font-size: 12pt; }
                .dept-score-item.market .dept-score { color: #e74c3c; }
                .dept-score-item.tech .dept-score { color: #3498db; }
                .dept-score-item.patent .dept-score { color: #9b59b6; }
                .dept-score-5 { font-size: 9pt; color: #999; margin-top: 5px; }
                
                /* 维度表格 */
                .dimension-tables { 
                    display: grid; 
                    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); 
                    gap: 20px;
                }
                .dimension-table-wrapper { 
                    border: 1px solid #e9ecef; 
                    border-radius: 8px; 
                    overflow: hidden;
                }
                .dimension-table-header { 
                    padding: 12px 15px; 
                    font-weight: bold;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .dimension-table-wrapper.market .dimension-table-header { background: rgba(231, 76, 60, 0.1); color: #e74c3c; }
                .dimension-table-wrapper.tech .dimension-table-header { background: rgba(52, 152, 219, 0.1); color: #3498db; }
                .dimension-table-wrapper.patent .dimension-table-header { background: rgba(155, 89, 182, 0.1); color: #9b59b6; }
                .dimension-total { margin-left: auto; font-size: 14pt; }
                .dimension-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
                .dimension-table th { 
                    background: #f8f9fa; 
                    padding: 8px; 
                    text-align: left;
                    border-bottom: 1px solid #e9ecef;
                }
                .dimension-table td { 
                    padding: 8px; 
                    border-bottom: 1px solid #f1f3f5;
                }
                .dimension-table .group-header { 
                    background: #f1f3f5; 
                    font-weight: 600;
                    color: #495057;
                }
                
                /* 分析框 */
                .analysis-box { 
                    padding: 20px; 
                    border-radius: 8px; 
                    margin-bottom: 15px;
                    page-break-inside: avoid;
                }
                .analysis-box.strengths { background: #e8f5e9; border-left: 4px solid #27ae60; }
                .analysis-box.weaknesses { background: #ffebee; border-left: 4px solid #e74c3c; }
                .analysis-title { 
                    font-size: 12pt; 
                    font-weight: bold; 
                    margin-bottom: 12px;
                }
                .analysis-box.strengths .analysis-title { color: #27ae60; }
                .analysis-box.weaknesses .analysis-title { color: #e74c3c; }
                .analysis-list { 
                    margin: 0; 
                    padding-left: 20px;
                }
                .analysis-list li { 
                    margin: 8px 0;
                    line-height: 1.6;
                }
                
                /* 决策框 */
                .decision-box { 
                    background: #f8f9fa; 
                    padding: 20px; 
                    border-radius: 8px;
                    margin-bottom: 20px;
                }
                .decision-header { 
                    font-size: 14pt; 
                    margin-bottom: 10px;
                }
                .decision-label { font-weight: 600; color: #555; }
                .decision-value { 
                    font-weight: bold; 
                    padding: 5px 15px;
                    border-radius: 4px;
                    margin-left: 10px;
                }
                .decision-value.positive { background: #e8f5e9; color: #27ae60; }
                .decision-value.neutral { background: #fff8e1; color: #f39c12; }
                .decision-value.negative { background: #ffebee; color: #e74c3c; }
                .risk-level { margin-top: 10px; }
                .risk-label { font-weight: 600; color: #555; }
                .risk-value { 
                    padding: 3px 12px;
                    border-radius: 4px;
                    margin-left: 10px;
                    font-size: 10pt;
                }
                .risk-value.risk-low { background: #e8f5e9; color: #27ae60; }
                .risk-value.risk-medium { background: #fff8e1; color: #f39c12; }
                .risk-value.risk-high { background: #ffebee; color: #e74c3c; }
                
                /* 策略框 */
                .strategy-box { 
                    background: #e3f2fd; 
                    padding: 20px; 
                    border-radius: 8px;
                    border-left: 4px solid #2196f3;
                    margin-bottom: 20px;
                    page-break-inside: avoid;
                }
                .strategy-title { 
                    font-size: 12pt; 
                    font-weight: bold; 
                    color: #2196f3;
                    margin-bottom: 12px;
                }
                .strategy-content { 
                    line-height: 1.8;
                    text-align: justify;
                }
                
                /* 行动计划 */
                .action-box { 
                    background: #f3e5f5; 
                    padding: 20px; 
                    border-radius: 8px;
                    border-left: 4px solid #9c27b0;
                    page-break-inside: avoid;
                }
                .action-title { 
                    font-size: 12pt; 
                    font-weight: bold; 
                    color: #9c27b0;
                    margin-bottom: 12px;
                }
                .action-list { 
                    margin: 0; 
                    padding-left: 0;
                    list-style: none;
                }
                .action-list li { 
                    margin: 10px 0;
                    display: flex;
                    align-items: flex-start;
                }
                .action-num { 
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 24px;
                    height: 24px;
                    background: #9c27b0;
                    color: white;
                    border-radius: 50%;
                    font-size: 10pt;
                    margin-right: 12px;
                    flex-shrink: 0;
                }
                
                /* 分数段指南 */
                .score-guide { 
                    padding: 20px; 
                    border-radius: 8px;
                    page-break-inside: avoid;
                }
                .score-guide.excellent { background: #e8f5e9; border: 1px solid #27ae60; }
                .score-guide.good { background: #e3f2fd; border: 1px solid #2196f3; }
                .score-guide.average { background: #fff8e1; border: 1px solid #f39c12; }
                .score-guide.caution { background: #fff3e0; border: 1px solid #ff9800; }
                .score-guide.poor { background: #ffebee; border: 1px solid #e74c3c; }
                .guide-header { 
                    font-size: 12pt; 
                    font-weight: bold;
                    margin-bottom: 12px;
                }
                .score-guide.excellent .guide-header { color: #27ae60; }
                .score-guide.good .guide-header { color: #2196f3; }
                .score-guide.average .guide-header { color: #f39c12; }
                .score-guide.caution .guide-header { color: #ff9800; }
                .score-guide.poor .guide-header { color: #e74c3c; }
                .guide-content p { 
                    margin: 8px 0;
                    line-height: 1.6;
                }
                
                /* 报告尾部 */
                .report-footer { 
                    text-align: center; 
                    padding: 30px 0;
                    margin-top: 40px;
                    border-top: 1px solid #e9ecef;
                    color: #999;
                    font-size: 9pt;
                }
                .report-footer p { margin: 5px 0; }
                
                /* 打印按钮 */
                .no-print { 
                    text-align: center;
                    padding: 20px;
                    background: #f8f9fa;
                    margin-bottom: 20px;
                }
                .no-print button { 
                    padding: 10px 30px;
                    font-size: 12pt;
                    cursor: pointer;
                    border: none;
                    border-radius: 4px;
                    margin: 0 10px;
                }
                .btn-print { background: #3498db; color: white; }
                .btn-close { background: #95a5a6; color: white; }
                
                @media print { 
                    .no-print { display: none !important; } 
                    body { padding: 0; }
                    .report-section { page-break-inside: avoid; }
                    .dimension-table-wrapper { page-break-inside: avoid; }
                    .analysis-box { page-break-inside: avoid; }
                    .strategy-box { page-break-inside: avoid; }
                    .action-box { page-break-inside: avoid; }
                    .score-guide { page-break-inside: avoid; }
                }
            </style>
        </head>
        <body>
            <div class="no-print">
                <button class="btn-print" onclick="window.print()">🖨️ 打印报告</button>
                <button class="btn-close" onclick="window.close()">✕ 关闭</button>
            </div>
            ${content}
        </body>
        </html>
    `);
    printWindow.document.close();
}

// 下载AI报告
function downloadAIReport() {
    const content = document.getElementById('aiReportContent').innerHTML;
    const title = document.getElementById('aiReportModalTitle').textContent;
    const fileName = title.replace(/[^\w\u4e00-\u9fa5]/g, '_') + '.html';
    
    const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <style>
        @page { size: A4; margin: 15mm; }
        * { box-sizing: border-box; }
        body { 
            font-family: "Microsoft YaHei", "SimSun", Arial, sans-serif; 
            color: #333; 
            line-height: 1.8;
            font-size: 11pt;
            max-width: 210mm;
            margin: 0 auto;
            padding: 20px;
        }
        
        .report-header-section { 
            text-align: center; 
            padding: 30px 0; 
            border-bottom: 3px double #2c3e50;
            margin-bottom: 25px;
        }
        .report-title { 
            font-size: 22pt; 
            font-weight: bold; 
            color: #2c3e50;
            letter-spacing: 3px;
            margin-bottom: 8px;
        }
        .report-subtitle { 
            font-size: 14pt; 
            color: #666;
            margin-bottom: 15px;
        }
        .report-meta { 
            font-size: 10pt; 
            color: #999;
        }
        .report-meta span { margin: 0 15px; }
        
        .report-section { 
            margin-bottom: 25px; 
            page-break-inside: avoid;
        }
        .section-title { 
            font-size: 14pt; 
            font-weight: bold; 
            color: #2c3e50;
            border-left: 4px solid #3498db;
            padding-left: 12px;
            margin-bottom: 15px;
            page-break-after: avoid;
        }
        
        .info-grid { 
            background: #f8f9fa; 
            padding: 15px 20px; 
            border-radius: 8px;
        }
        .info-row { 
            display: flex; 
            margin: 8px 0;
        }
        .info-label { 
            font-weight: 600; 
            color: #555;
            min-width: 100px;
        }
        .info-value { 
            color: #333;
            flex: 1;
        }
        
        .description-box { 
            background: #f8f9fa; 
            padding: 20px; 
            border-radius: 8px;
            border: 1px solid #e9ecef;
            line-height: 1.8;
            text-align: justify;
        }
        
        .report-images-grid { 
            display: grid; 
            grid-template-columns: repeat(3, 1fr); 
            gap: 15px;
        }
        .report-image-item { 
            text-align: center;
        }
        .report-image-item img { 
            width: 100%; 
            max-height: 150px; 
            object-fit: contain; 
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        .image-caption { 
            display: block; 
            font-size: 9pt; 
            color: #666;
            margin-top: 5px;
        }
        .no-data { 
            color: #999; 
            font-style: italic;
            text-align: center;
            padding: 20px;
        }
        
        .total-score-box { 
            text-align: center; 
            padding: 30px; 
            border-radius: 12px;
            margin-bottom: 20px;
        }
        .total-score-box.level-excellent { background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%); color: white; }
        .total-score-box.level-good { background: linear-gradient(135deg, #3498db 0%, #5dade2 100%); color: white; }
        .total-score-box.level-average { background: linear-gradient(135deg, #f39c12 0%, #f5b041 100%); color: white; }
        .total-score-box.level-poor { background: linear-gradient(135deg, #e74c3c 0%, #ec7063 100%); color: white; }
        .score-number { font-size: 56pt; font-weight: bold; }
        .score-unit { font-size: 18pt; }
        .score-level { 
            font-size: 14pt; 
            margin-top: 10px;
            padding: 8px 20px;
            background: rgba(255,255,255,0.2);
            border-radius: 20px;
            display: inline-block;
        }
        
        .dept-scores-detail { 
            display: grid; 
            grid-template-columns: repeat(3, 1fr); 
            gap: 15px;
        }
        .dept-score-item { 
            text-align: center; 
            padding: 20px; 
            border-radius: 10px;
            border: 2px solid;
        }
        .dept-score-item.market { border-color: #e74c3c; background: rgba(231, 76, 60, 0.05); }
        .dept-score-item.tech { border-color: #3498db; background: rgba(52, 152, 219, 0.05); }
        .dept-score-item.patent { border-color: #9b59b6; background: rgba(155, 89, 182, 0.05); }
        .dept-icon { font-size: 24pt; margin-bottom: 5px; }
        .dept-name { font-size: 11pt; color: #666; margin-bottom: 8px; }
        .dept-score { font-size: 28pt; font-weight: bold; }
        .dept-score span { font-size: 12pt; }
        .dept-score-item.market .dept-score { color: #e74c3c; }
        .dept-score-item.tech .dept-score { color: #3498db; }
        .dept-score-item.patent .dept-score { color: #9b59b6; }
        .dept-score-5 { font-size: 9pt; color: #999; margin-top: 5px; }
        
        .dimension-tables { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); 
            gap: 20px;
        }
        .dimension-table-wrapper { 
            border: 1px solid #e9ecef; 
            border-radius: 8px; 
            overflow: hidden;
        }
        .dimension-table-header { 
            padding: 12px 15px; 
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .dimension-table-wrapper.market .dimension-table-header { background: rgba(231, 76, 60, 0.1); color: #e74c3c; }
        .dimension-table-wrapper.tech .dimension-table-header { background: rgba(52, 152, 219, 0.1); color: #3498db; }
        .dimension-table-wrapper.patent .dimension-table-header { background: rgba(155, 89, 182, 0.1); color: #9b59b6; }
        .dimension-total { margin-left: auto; font-size: 14pt; }
        .dimension-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
        .dimension-table th { 
            background: #f8f9fa; 
            padding: 8px; 
            text-align: left;
            border-bottom: 1px solid #e9ecef;
        }
        .dimension-table td { 
            padding: 8px; 
            border-bottom: 1px solid #f1f3f5;
        }
        .dimension-table .group-header { 
            background: #f1f3f5; 
            font-weight: 600;
            color: #495057;
        }
        
        .analysis-box { 
            padding: 20px; 
            border-radius: 8px; 
            margin-bottom: 15px;
            page-break-inside: avoid;
        }
        .analysis-box.strengths { background: #e8f5e9; border-left: 4px solid #27ae60; }
        .analysis-box.weaknesses { background: #ffebee; border-left: 4px solid #e74c3c; }
        .analysis-title { 
            font-size: 12pt; 
            font-weight: bold; 
            margin-bottom: 12px;
        }
        .analysis-box.strengths .analysis-title { color: #27ae60; }
        .analysis-box.weaknesses .analysis-title { color: #e74c3c; }
        .analysis-list { 
            margin: 0; 
            padding-left: 20px;
        }
        .analysis-list li { 
            margin: 8px 0;
            line-height: 1.6;
        }
        
        .decision-box { 
            background: #f8f9fa; 
            padding: 20px; 
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .decision-header { 
            font-size: 14pt; 
            margin-bottom: 10px;
        }
        .decision-label { font-weight: 600; color: #555; }
        .decision-value { 
            font-weight: bold; 
            padding: 5px 15px;
            border-radius: 4px;
            margin-left: 10px;
        }
        .decision-value.positive { background: #e8f5e9; color: #27ae60; }
        .decision-value.neutral { background: #fff8e1; color: #f39c12; }
        .decision-value.negative { background: #ffebee; color: #e74c3c; }
        .risk-level { margin-top: 10px; }
        .risk-label { font-weight: 600; color: #555; }
        .risk-value { 
            padding: 3px 12px;
            border-radius: 4px;
            margin-left: 10px;
            font-size: 10pt;
        }
        .risk-value.risk-low { background: #e8f5e9; color: #27ae60; }
        .risk-value.risk-medium { background: #fff8e1; color: #f39c12; }
        .risk-value.risk-high { background: #ffebee; color: #e74c3c; }
        
        .strategy-box { 
            background: #e3f2fd; 
            padding: 20px; 
            border-radius: 8px;
            border-left: 4px solid #2196f3;
            margin-bottom: 20px;
            page-break-inside: avoid;
        }
        .strategy-title { 
            font-size: 12pt; 
            font-weight: bold; 
            color: #2196f3;
            margin-bottom: 12px;
        }
        .strategy-content { 
            line-height: 1.8;
            text-align: justify;
        }
        
        .action-box { 
            background: #f3e5f5; 
            padding: 20px; 
            border-radius: 8px;
            border-left: 4px solid #9c27b0;
            page-break-inside: avoid;
        }
        .action-title { 
            font-size: 12pt; 
            font-weight: bold; 
            color: #9c27b0;
            margin-bottom: 12px;
        }
        .action-list { 
            margin: 0; 
            padding-left: 0;
            list-style: none;
        }
        .action-list li { 
            margin: 10px 0;
            display: flex;
            align-items: flex-start;
        }
        .action-num { 
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            background: #9c27b0;
            color: white;
            border-radius: 50%;
            font-size: 10pt;
            margin-right: 12px;
            flex-shrink: 0;
        }
        
        .score-guide { 
            padding: 20px; 
            border-radius: 8px;
            page-break-inside: avoid;
        }
        .score-guide.excellent { background: #e8f5e9; border: 1px solid #27ae60; }
        .score-guide.good { background: #e3f2fd; border: 1px solid #2196f3; }
        .score-guide.average { background: #fff8e1; border: 1px solid #f39c12; }
        .score-guide.caution { background: #fff3e0; border: 1px solid #ff9800; }
        .score-guide.poor { background: #ffebee; border: 1px solid #e74c3c; }
        .guide-header { 
            font-size: 12pt; 
            font-weight: bold;
            margin-bottom: 12px;
        }
        .score-guide.excellent .guide-header { color: #27ae60; }
        .score-guide.good .guide-header { color: #2196f3; }
        .score-guide.average .guide-header { color: #f39c12; }
        .score-guide.caution .guide-header { color: #ff9800; }
        .score-guide.poor .guide-header { color: #e74c3c; }
        .guide-content p { 
            margin: 8px 0;
            line-height: 1.6;
        }
        
        .report-footer { 
            text-align: center; 
            padding: 30px 0;
            margin-top: 40px;
            border-top: 1px solid #e9ecef;
            color: #999;
            font-size: 9pt;
        }
        .report-footer p { margin: 5px 0; }
        
        @media print { 
            body { padding: 0; }
            .report-section { page-break-inside: avoid; }
            .dimension-table-wrapper { page-break-inside: avoid; }
            .analysis-box { page-break-inside: avoid; }
            .strategy-box { page-break-inside: avoid; }
            .action-box { page-break-inside: avoid; }
            .score-guide { page-break-inside: avoid; }
        }
    </style>
</head>
<body>
    ${content}
</body>
</html>`;

    const blob = new Blob([fullHTML], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== 评估报告模块 ====================
function showReportModal(projectId) {
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === projectId);
    const evals = db.evaluations.filter(e => e.project_id === projectId);

    if (!project) {
        alert('项目不存在');
        return;
    }

    const depts = [...new Set(evals.map(e => e.department))];
    if (!depts.includes('market') || !depts.includes('tech') || !depts.includes('patent')) {
        alert('请等待三端评估完成后再生成报告');
        return;
    }

    const reportHTML = generateReportHTML(project, evals);
    document.getElementById('reportContent').innerHTML = reportHTML;
    document.getElementById('reportModalTitle').textContent = '📊 技术方案评估报告 - ' + project.name;
    show('reportModal');
}

function closeReportModal() {
    hide('reportModal');
}

function generateReportHTML(project, evals) {
    const marketEval = evals.find(e => e.department === 'market');
    const techEval = evals.find(e => e.department === 'tech');
    const patentEval = evals.find(e => e.department === 'patent');

    const avgScore5 = ((marketEval.total_score + techEval.total_score + patentEval.total_score) / 3);
    const avgScore100 = (avgScore5 * 20).toFixed(1);
    const level = Utils.getLevel(avgScore5);

    // 生成各维度雷达图数据
    const radarData = {
        market: calculateDimensionScores(marketEval),
        tech: calculateDimensionScores(techEval),
        patent: calculateDimensionScores(patentEval)
    };

    return `
        <div class="report-header">
            <h1>📊 技术方案评估报告</h1>
            <p><strong>方案名称：</strong>${escapeHtml(project.name)}</p>
            <p><strong>创建人：</strong>${project.creator} | <strong>创建时间：</strong>${Utils.formatDate(project.created_at)}</p>
            <p><strong>报告生成时间：</strong>${Utils.formatDate(Date.now(), true)}</p>
        </div>

        <div class="report-section">
            <h2>📈 综合评分概览（100分制）</h2>
            <div class="score-overview">
                <div class="score-box main" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                    <div class="score-label">综合总分</div>
                    <div class="score-value" style="font-size: 4rem;">${avgScore100}</div>
                    <div style="font-size: 0.9rem; opacity: 0.9; margin-top: 5px;">满分100分</div>
                    <span class="level-badge ${level.class}" style="margin-top: 15px; font-size: 1rem; padding: 8px 20px;">${level.title}</span>
                </div>
            </div>
            
            <!-- 三端评分对比 -->
            <div class="dept-scores" style="margin-top: 25px;">
                <div class="dept-score market" style="background: rgba(231, 76, 60, 0.1); border: 2px solid #e74c3c; border-radius: 12px; padding: 20px;">
                    <div class="dept-name" style="color: #e74c3c; font-weight: 600;">🏢 市场端</div>
                    <div class="dept-value" style="color: #e74c3c; font-size: 2.5rem;">${(marketEval.total_score * 20).toFixed(1)}<span style="font-size: 1rem;">分</span></div>
                    <div style="font-size: 0.85rem; color: #95a5a6; margin-top: 5px;">5分制: ${marketEval.total_score.toFixed(2)}</div>
                </div>
                <div class="dept-score tech" style="background: rgba(52, 152, 219, 0.1); border: 2px solid #3498db; border-radius: 12px; padding: 20px;">
                    <div class="dept-name" style="color: #3498db; font-weight: 600;">🔬 研发端</div>
                    <div class="dept-value" style="color: #3498db; font-size: 2.5rem;">${(techEval.total_score * 20).toFixed(1)}<span style="font-size: 1rem;">分</span></div>
                    <div style="font-size: 0.85rem; color: #95a5a6; margin-top: 5px;">5分制: ${techEval.total_score.toFixed(2)}</div>
                </div>
                <div class="dept-score patent" style="background: rgba(155, 89, 182, 0.1); border: 2px solid #9b59b6; border-radius: 12px; padding: 20px;">
                    <div class="dept-name" style="color: #9b59b6; font-weight: 600;">⚖️ 专利端</div>
                    <div class="dept-value" style="color: #9b59b6; font-size: 2.5rem;">${(patentEval.total_score * 20).toFixed(1)}<span style="font-size: 1rem;">分</span></div>
                    <div style="font-size: 0.85rem; color: #95a5a6; margin-top: 5px;">5分制: ${patentEval.total_score.toFixed(2)}</div>
                </div>
            </div>
        </div>

        <!-- 各维度雷达图对比 -->
        <div class="report-section">
            <h2>📊 各维度雷达图对比</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 15px;">
                ${generateRadarCard('market', marketEval, radarData.market)}
                ${generateRadarCard('tech', techEval, radarData.tech)}
                ${generateRadarCard('patent', patentEval, radarData.patent)}
            </div>
        </div>

        <!-- 价值评定 -->
        <div class="report-section">
            <h2>🎯 价值评定</h2>
            ${generateScoreRangeGuide(avgScore100)}
        </div>

        ${generateMarketDetailSection(marketEval)}
        ${generateTechDetailSection(techEval)}
        ${generatePatentDetailSection(patentEval)}

        <div class="report-section">
            <h2>💡 综合指导建议</h2>
            <div class="suggestions">
                ${generateOverallComment(avgScore5, marketEval.total_score, techEval.total_score, patentEval.total_score)}
            </div>
        </div>
    `;
}

// 生成雷达图卡片
function generateRadarCard(dept, evalData, dimensionScores) {
    if (!evalData || Object.keys(dimensionScores).length === 0) return '';
    
    const deptColors = {
        market: { bg: 'rgba(231, 76, 60, 0.1)', border: '#e74c3c', name: '市场端' },
        tech: { bg: 'rgba(52, 152, 219, 0.1)', border: '#3498db', name: '研发端' },
        patent: { bg: 'rgba(155, 89, 182, 0.1)', border: '#9b59b6', name: '专利端' }
    };
    const colors = deptColors[dept];
    const score100 = (evalData.total_score * 20).toFixed(1);
    
    // 生成维度分数列表
    const scoresList = Object.entries(dimensionScores).map(([dim, score]) => {
        const score100 = (score * 20).toFixed(0);
        return `<div style="display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px dashed #eee;"><span>${dim}</span><span style="font-weight: 600; color: ${colors.border};">${score.toFixed(1)}分 (${score100}分)</span></div>`;
    }).join('');
    
    return `
        <div style="background: ${colors.bg}; border: 2px solid ${colors.border}; border-radius: 12px; padding: 20px;">
            <h3 style="color: ${colors.border}; margin-bottom: 10px; font-size: 1.1rem;">${colors.name}</h3>
            <div style="text-align: center; margin-bottom: 15px;">
                <div style="font-size: 2rem; font-weight: 700; color: ${colors.border};">${score100}<span style="font-size: 1rem;">分</span></div>
                <div style="font-size: 0.85rem; color: #666;">5分制: ${evalData.total_score.toFixed(2)}</div>
            </div>
            <div style="font-size: 0.9rem;">${scoresList}</div>
        </div>
    `;
}

function generateMarketDetailSection(evalData) {
    if (!evalData || !evalData.sub_scores) return '';
    const s = evalData.sub_scores;

    return `
        <div class="report-section">
            <h2 class="dept-title market">🎯 市场端详细评估</h2>
            <p class="eval-meta">评估人：${evalData.evaluator} | 提交时间：${Utils.formatDate(evalData.submitted_at, true)}</p>
            <table class="score-table">
                <thead>
                    <tr><th>评估维度</th><th>得分</th><th>权重</th></tr>
                </thead>
                <tbody>
                    <tr class="group-header"><td colspan="3">【核心点 1】用户买不买单？(50%)</td></tr>
                    <tr><td>是否属于 Top 级需求？</td><td>${s.m1_1 || '-'}</td><td>40%</td></tr>
                    <tr><td>是否未被满足？</td><td>${s.m1_2 || '-'}</td><td>35%</td></tr>
                    <tr><td>是否 Top 级痛点？</td><td>${s.m1_3 || '-'}</td><td>25%</td></tr>
                    <tr class="group-header"><td colspan="3">【核心点 2】用户愿花多少钱？(30%)</td></tr>
                    <tr><td>竞争格局？</td><td>${s.m2_1 || '-'}</td><td>40%</td></tr>
                    <tr><td>溢价能力？</td><td>${s.m2_2 || '-'}</td><td>60%</td></tr>
                    <tr class="group-header"><td colspan="3">【核心点 3】市场规模与增长 (20%)</td></tr>
                    <tr><td>市场规模？</td><td>${s.m3_1 || '-'}</td><td>50%</td></tr>
                    <tr><td>成长性？</td><td>${s.m3_2 || '-'}</td><td>50%</td></tr>
                </tbody>
            </table>
        </div>
    `;
}

function generateTechDetailSection(evalData) {
    if (!evalData || !evalData.sub_scores) return '';
    const s = evalData.sub_scores;

    return `
        <div class="report-section">
            <h2 class="dept-title tech">🔬 研发端详细评估</h2>
            <p class="eval-meta">评估人：${evalData.evaluator} | 提交时间：${Utils.formatDate(evalData.submitted_at, true)}</p>
            <table class="score-table">
                <thead>
                    <tr><th>评估维度</th><th>得分</th></tr>
                </thead>
                <tbody>
                    <tr class="group-header"><td colspan="2">【核心点 1】创新程度 (40%)</td></tr>
                    <tr><td>创新程度？</td><td>${s.t1_1 || '-'}</td></tr>
                    <tr class="group-header"><td colspan="2">【核心点 2】竞争优势 (30%)</td></tr>
                    <tr><td>相比竞品优势？</td><td>${s.t2_1 || '-'}</td></tr>
                    <tr class="group-header"><td colspan="2">【核心点 3】可扩展性 (30%)</td></tr>
                    <tr><td>可迁移应用？</td><td>${s.t3_1 || '-'}</td></tr>
                </tbody>
            </table>
        </div>
    `;
}

function generatePatentDetailSection(evalData) {
    if (!evalData || !evalData.sub_scores) return '';
    const s = evalData.sub_scores;

    return `
        <div class="report-section">
            <h2 class="dept-title patent">⚖️ 专利端详细评估</h2>
            <p class="eval-meta">评估人：${evalData.evaluator} | 提交时间：${Utils.formatDate(evalData.submitted_at, true)}</p>
            <table class="score-table">
                <thead>
                    <tr><th>评估维度</th><th>得分</th><th>权重</th></tr>
                </thead>
                <tbody>
                    <tr class="group-header"><td colspan="3">【核心点 1】新颖性 (30%)</td></tr>
                    <tr><td>授权前景？</td><td>${s.p1_1 || '-'}</td><td>100%</td></tr>
                    <tr class="group-header"><td colspan="3">【核心点 2】撰写空间 (50%)</td></tr>
                    <tr><td>保护范围？</td><td>${s.p2_1 || '-'}</td><td>100%</td></tr>
                    <tr class="group-header"><td colspan="3">【核心点 3】取证难度 (20%)</td></tr>
                    <tr><td>维权难易？</td><td>${s.p3_1 || '-'}</td><td>100%</td></tr>
                </tbody>
            </table>
        </div>
    `;
}

function printReport() {
    const reportContent = document.getElementById('reportContent').innerHTML;
    const title = document.getElementById('reportModalTitle').textContent;

    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>${title}</title>
            <style>
                body { font-family: "Microsoft YaHei", Arial, sans-serif; padding: 40px; color: #333; max-width: 900px; margin: 0 auto; }
                h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 15px; margin-bottom: 30px; }
                h2 { color: #34495e; margin-top: 30px; border-left: 4px solid #3498db; padding-left: 15px; }
                .report-header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
                .report-section { margin: 30px 0; }
                .score-overview { text-align: center; margin: 20px 0; }
                .score-box { display: inline-block; padding: 20px 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px; }
                .score-box.main .score-value { font-size: 48px; font-weight: bold; }
                .score-box .score-label { font-size: 14px; opacity: 0.9; }
                .level-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; margin-top: 10px; }
                .level-excellent { background: #27ae60; }
                .level-good { background: #3498db; }
                .level-average { background: #f39c12; }
                .level-poor { background: #e74c3c; }
                .dept-scores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 20px; }
                .dept-score { padding: 15px; border-radius: 8px; text-align: center; }
                .dept-score.market { background: rgba(231, 76, 60, 0.1); border: 2px solid #e74c3c; }
                .dept-score.tech { background: rgba(52, 152, 219, 0.1); border: 2px solid #3498db; }
                .dept-score.patent { background: rgba(155, 89, 182, 0.1); border: 2px solid #9b59b6; }
                .dept-name { font-size: 14px; color: #7f8c8d; }
                .dept-value { font-size: 32px; font-weight: bold; margin-top: 5px; }
                .dept-score.market .dept-value { color: #e74c3c; }
                .dept-score.tech .dept-value { color: #3498db; }
                .dept-score.patent .dept-value { color: #9b59b6; }
                .dept-title.market { border-color: #e74c3c; color: #e74c3c; }
                .dept-title.tech { border-color: #3498db; color: #3498db; }
                .dept-title.patent { border-color: #9b59b6; color: #9b59b6; }
                .eval-meta { color: #7f8c8d; font-size: 14px; margin-bottom: 15px; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                th { background: #3498db; color: white; }
                tr:nth-child(even) { background: #f8f9fa; }
                .group-header { background: #ecf0f1; font-weight: bold; }
                .suggestions { background: #e8f4fd; padding: 20px; border-radius: 8px; border-left: 4px solid #3498db; line-height: 1.8; }
                @media print {
                    body { padding: 20px; }
                    .no-print { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="no-print" style="text-align:right;margin-bottom:20px;">
                <button onclick="window.print()" style="padding:10px 20px;font-size:14px;cursor:pointer;">🖨️ 打印</button>
                <button onclick="window.close()" style="padding:10px 20px;font-size:14px;cursor:pointer;margin-left:10px;">✕ 关闭</button>
            </div>
            ${reportContent}
            <div style="margin-top:40px;padding-top:20px;border-top:2px solid #e9ecef;color:#7f8c8d;font-size:12px;text-align:center;">
                <p>本报告由专利技术方案三方评估系统自动生成 | 生成时间：${new Date().toLocaleString('zh-CN')}</p>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function downloadReport() {
    const reportContent = document.getElementById('reportContent').innerHTML;
    const db = DataStore.getDB();
    const project = db.projects.find(p => p.id === currentProjectId);

    if (!project) return;

    const fileName = `技术方案评估报告-${project.name}-${new Date().toISOString().split('T')[0]}.html`;

    const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>技术方案评估报告 - ${escapeHtml(project.name)}</title>
    <style>
        body { font-family: "Microsoft YaHei", Arial, sans-serif; padding: 40px; color: #333; max-width: 900px; margin: 0 auto; }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 15px; margin-bottom: 30px; }
        h2 { color: #34495e; margin-top: 30px; border-left: 4px solid #3498db; padding-left: 15px; }
        .report-header { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
        .report-section { margin: 30px 0; }
        .score-overview { text-align: center; margin: 20px 0; }
        .score-box { display: inline-block; padding: 20px 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px; }
        .score-box.main .score-value { font-size: 48px; font-weight: bold; }
        .score-box .score-label { font-size: 14px; opacity: 0.9; }
        .level-badge { display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; margin-top: 10px; }
        .level-excellent { background: #27ae60; }
        .level-good { background: #3498db; }
        .level-average { background: #f39c12; }
        .level-poor { background: #e74c3c; }
        .dept-scores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 20px; }
        .dept-score { padding: 15px; border-radius: 8px; text-align: center; }
        .dept-score.market { background: rgba(231, 76, 60, 0.1); border: 2px solid #e74c3c; }
        .dept-score.tech { background: rgba(52, 152, 219, 0.1); border: 2px solid #3498db; }
        .dept-score.patent { background: rgba(155, 89, 182, 0.1); border: 2px solid #9b59b6; }
        .dept-name { font-size: 14px; color: #7f8c8d; }
        .dept-value { font-size: 32px; font-weight: bold; margin-top: 5px; }
        .dept-score.market .dept-value { color: #e74c3c; }
        .dept-score.tech .dept-value { color: #3498db; }
        .dept-score.patent .dept-value { color: #9b59b6; }
        .dept-title.market { border-color: #e74c3c; color: #e74c3c; }
        .dept-title.tech { border-color: #3498db; color: #3498db; }
        .dept-title.patent { border-color: #9b59b6; color: #9b59b6; }
        .eval-meta { color: #7f8c8d; font-size: 14px; margin-bottom: 15px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background: #3498db; color: white; }
        tr:nth-child(even) { background: #f8f9fa; }
        .group-header { background: #ecf0f1; font-weight: bold; }
        .suggestions { background: #e8f4fd; padding: 20px; border-radius: 8px; border-left: 4px solid #3498db; line-height: 1.8; }
    </style>
</head>
<body>
    ${reportContent}
    <div style="margin-top:40px;padding-top:20px;border-top:2px solid #e9ecef;color:#7f8c8d;font-size:12px;text-align:center;">
        <p>本报告由专利技术方案三方评估系统自动生成 | 生成时间：${new Date().toLocaleString('zh-CN')}</p>
    </div>
</body>
</html>`;

    const blob = new Blob([fullHTML], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== 数据管理模块 ====================
function exportData() {
    const exportType = document.querySelector('input[name="exportType"]:checked')?.value || 'all';
    const db = DataStore.getDB();

    let dataToExport;
    if (exportType === 'projects') {
        dataToExport = { projects: db.projects, evaluations: [] };
    } else if (exportType === 'evaluations') {
        dataToExport = { projects: [], evaluations: db.evaluations };
    } else {
        dataToExport = db;
    }

    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `专利评估数据_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importData(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            const db = DataStore.getDB();

            let newProjects = 0;
            let newEvaluations = 0;

            // 合并项目
            if (imported.projects && Array.isArray(imported.projects)) {
                imported.projects.forEach(p => {
                    if (!db.projects.find(x => x.id === p.id)) {
                        db.projects.push(p);
                        newProjects++;
                    }
                });
            }

            // 合并评估
            if (imported.evaluations && Array.isArray(imported.evaluations)) {
                imported.evaluations.forEach(ev => {
                    if (!db.evaluations.find(x => x.id === ev.id)) {
                        db.evaluations.push(ev);
                        newEvaluations++;
                    }
                });
            }

            if (DataStore.saveDB(db)) {
                alert(`导入成功！新增 ${newProjects} 个项目，${newEvaluations} 条评估`);
                loadProjects();
            }
        } catch (err) {
            alert('文件格式错误：' + err.message);
        }
        input.value = '';
    };
    reader.readAsText(file);
}

function clearAllData() {
    showConfirmModal(
        '清空所有数据',
        '确定要清空所有数据吗？此操作不可恢复！\n\n建议先导出数据备份。',
        () => {
            DataStore.clearAll();
            closeConfirmModal();
            alert('数据已清空');
            location.reload();
        }
    );
}

// ==================== 数据备份模块 ====================
function createBackup() {
    if (DataStore.createBackup()) {
        updateBackupStatus();
        alert('✅ 备份创建成功！');
    } else {
        alert('❌ 备份创建失败');
    }
}

function restoreBackup() {
    const backup = DataStore.getBackup();
    if (!backup) {
        alert('没有找到备份数据');
        return;
    }

    showConfirmModal(
        '恢复备份',
        `确定要恢复到 ${Utils.formatDate(backup.timestamp)} 的备份吗？\n\n当前数据将被覆盖！`,
        () => {
            if (DataStore.restoreBackup()) {
                closeConfirmModal();
                alert('✅ 备份恢复成功！');
                loadProjects();
                updateBackupStatus();
            } else {
                alert('❌ 备份恢复失败');
            }
        }
    );
}

function updateBackupStatus() {
    const backup = DataStore.getBackup();
    const statusEl = document.getElementById('backupStatus');
    if (statusEl) {
        if (backup) {
            statusEl.innerHTML = `
                <span style="color:#27ae60;">✅ 上次备份：${Utils.formatDate(backup.timestamp, true)}</span>
            `;
        } else {
            statusEl.innerHTML = '<span style="color:#999;">暂无备份</span>';
        }
    }
}

// ==================== HTML 转义工具 ====================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== 初始化 ====================
window.addEventListener('DOMContentLoaded', function() {
    // 首先检查并更新数据状态显示
    checkAndUpdateDataStatus();
    
    const savedUser = DataStore.getCurrentUser();
    if (savedUser) {
        currentUser = savedUser;
        initApp();
    }

    // 添加输入防抖
    const searchInputs = document.querySelectorAll('input[id$="Search"]');
    searchInputs.forEach(input => {
        input.addEventListener('input', Utils.debounce(() => {
            if (input.id === 'projectSearch') {
                filterProjects();
            } else if (input.id === 'historySearch') {
                filterHistory();
            }
        }, 300));
    });
});

// 检查并更新数据状态显示
function checkAndUpdateDataStatus() {
    const statusEl = document.getElementById('dataStatusText');
    if (!statusEl) return;
    
    // 检查 EMAS 配置
    if (typeof BMOB_CONFIG === 'undefined') {
        statusEl.innerHTML = '<strong>💡 数据说明：</strong>未找到配置文件，数据将保存在浏览器本地。';
        return;
    }
    
    if (!BMOB_CONFIG.SPACE_ID || !BMOB_CONFIG.REST_API_KEY) {
        statusEl.innerHTML = '<strong>💡 数据说明：</strong>EMAS 配置不完整，数据将保存在浏览器本地。';
        return;
    }
    
    // 配置存在，提示正在连接
    statusEl.innerHTML = '<strong style="color:#f39c12;">🔄 正在连接云端...</strong>登录后将自动同步数据，支持多人实时协作！';
}

// 键盘快捷键
document.addEventListener('keydown', function(e) {
    // ESC 关闭弹窗
    if (e.key === 'Escape') {
        closeRadarModal();
        closeGuideModal();
        closeReportModal();
        closeEditModal();
        closeConfirmModal();
        closeImageViewer();
    }
});

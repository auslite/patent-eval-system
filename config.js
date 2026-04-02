/**
 * Bmob 后端云配置
 * 国内可用，无需翻墙
 * 注册地址：https://www.bmobapp.com
 * 
 * 配置步骤：
 * 1. 访问 https://www.bmobapp.com 注册账号
 * 2. 创建新应用（选择开发版，免费3个月）
 * 3. 进入应用后台，获取 Application ID 和 REST API Key
 * 4. 将下面的配置替换为你的实际值
 */
const BMOB_CONFIG = {
    // Bmob Application ID（从控制台获取）
    APPLICATION_ID: '81d7f20e0397824f13f40ad8feebf84e',
    
    // Bmob REST API Key（从控制台获取）
    REST_API_KEY: '1a0d5f66d38d83df201a185cf493528b',
    
    // Bmob 服务器地址（国内用户默认即可）
    HOST: 'https://open2.bmob.cn',
    
    // 邀请码（可修改为你喜欢的）
    INVITE_CODE: '5201314'
};

// 兼容旧版模块化环境
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BMOB_CONFIG;
}

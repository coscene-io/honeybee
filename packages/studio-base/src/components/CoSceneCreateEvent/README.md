# CoSceneCreateEvent 组件重构

## 概述

这个目录包含了重构后的事件创建组件，原本是一个超过1200行的大型组件文件，现在被拆分为多个小的、可维护的组件。

## 文件结构

```
CoSceneCreateEvent/
├── README.md                          # 说明文档
├── index.ts                          # 导出文件
├── types.ts                          # 类型定义
├── constants.ts                      # 常量定义
├── utils.ts                          # 工具函数
├── CoSceneCreateEventContainer.tsx   # 主容器组件
├── EventForm.tsx                     # 事件表单组件
├── TaskForm.tsx                      # 任务表单组件
├── ImageUpload.tsx                   # 图片上传组件
├── MetadataEditor.tsx                # 元数据编辑器组件
├── CreateTaskSuccessToast.tsx        # 成功提示组件
└── hooks/
    ├── useEventOperations.ts         # 事件操作hook
    └── useTaskOperations.ts          # 任务操作hook
```

## 重构优势

### 1. 模块化设计

- **单一职责**: 每个组件只负责一个特定功能
- **可复用性**: 组件可以在其他地方独立使用
- **易于测试**: 小组件更容易编写单元测试

### 2. 类型安全

- **统一类型定义**: 所有类型定义集中在 `types.ts`
- **严格类型检查**: 使用TypeScript确保类型安全
- **接口一致性**: 组件间接口定义清晰

### 3. 逻辑分离

- **业务逻辑**: 提取到自定义hooks中
- **UI逻辑**: 保留在组件中
- **工具函数**: 独立的工具函数文件

### 4. 可维护性

- **代码组织**: 清晰的文件结构
- **依赖管理**: 明确的导入导出关系
- **文档完善**: 每个文件都有清晰的注释

## 组件说明

### CoSceneCreateEventContainer

主容器组件，负责：

- 状态管理
- 数据获取
- 组件协调

### EventForm

事件表单组件，包含：

- 事件名称输入
- 时间显示
- 描述输入
- 图片上传
- 元数据编辑
- 自定义字段

### TaskForm

任务表单组件，包含：

- 任务名称
- 任务描述
- 指派人选择
- 自定义字段
- 同步设置

### ImageUpload

图片上传组件，支持：

- 图片选择
- 图片预览
- 图片删除

### MetadataEditor

元数据编辑器，支持：

- 键值对编辑
- 动态添加/删除行
- 特殊字段处理（如pivotMetric）

## Hooks说明

### useEventOperations

处理事件相关操作：

- 创建事件
- 编辑事件
- 图片上传
- 错误处理

### useTaskOperations

处理任务相关操作：

- 创建任务
- 任务同步
- 成功提示

## 使用方式

```tsx
import { CoSceneCreateEventContainer } from "@foxglove/studio-base/components/CoSceneCreateEvent";

function MyComponent() {
  const handleClose = () => {
    // 关闭逻辑
  };

  return <CoSceneCreateEventContainer onClose={handleClose} />;
}
```

## 注意事项

1. **类型兼容性**: 确保与现有EventsContext中的类型兼容
2. **依赖管理**: 注意组件间的依赖关系
3. **性能优化**: 使用React.memo等优化手段
4. **错误边界**: 考虑添加错误边界组件

## 未来改进

1. **单元测试**: 为每个组件添加完整的单元测试
2. **Storybook**: 添加组件文档和示例
3. **性能优化**: 进一步优化渲染性能
4. **国际化**: 完善多语言支持
5. **无障碍性**: 改进无障碍访问支持
